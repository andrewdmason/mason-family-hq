import SwiftUI

// The menu that slides in from the left, the way Claude's and ChatGPT's do:
// Classes and Study at the top, the chats under them, and the account and a
// new chat along the bottom. It's somewhere to pass through; picking anything
// closes it on what was picked (ChatsView, TuttlesApp.swift).

/// Whether the menu is out, shared with the screens that open it.
@MainActor
@Observable
final class SideMenuState {
    var isOpen: Bool
    /// In a call: no sliding the menu open.
    var locked = false

    init(isOpen: Bool = false) { self.isOpen = isOpen }
}

/// The ☰ where a back button would be, on whatever's at the bottom of the stack.
struct MenuToolbarButton: View {
    @Environment(SideMenuState.self) private var menu: SideMenuState?

    var body: some View {
        Button {
            withAnimation(.snappy(duration: 0.3)) { menu?.isOpen = true }
        } label: {
            Image(systemName: "line.3.horizontal")
        }
        .accessibilityLabel("Menu")
    }
}

extension View {
    /// The menu button, on the screen at the bottom of the stack.
    @ViewBuilder func menuButton(_ shown: Bool) -> some View {
        if shown {
            toolbar { ToolbarItem(placement: .topBarLeading) { MenuToolbarButton() } }
        } else {
            self
        }
    }
}

struct SideMenu: View {
    /// What's open, to highlight it.
    let current: Route
    @Binding var showingMemory: Bool
    let open: (Route) -> Void
    @Environment(ChatStore.self) private var store

    var body: some View {
        List {
            Section {
                if store.showingParentView {
                    place("This week", systemImage: "calendar", .week)
                } else {
                    place("Classes", systemImage: "books.vertical", .classes)
                    place("Study", systemImage: "checklist", .study)
                }
            }
            Section {
                if !store.threadsLoaded {
                    ForEach(0..<4, id: \.self) { _ in
                        Text("Loading a chat title")
                            .font(.body)
                            .redacted(reason: .placeholder)
                            .listRowBackground(Color.clear)
                    }
                }
                if let error = store.listError {
                    Text(error).foregroundStyle(.secondary).listRowBackground(Color.clear)
                } else if store.threadsLoaded, threads.isEmpty {
                    Text(store.showingParentView ? "No briefings yet" : "No chats yet")
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                }
                ForEach(threads) { thread in
                    Button { open(.chat(thread.id, isNew: false)) } label: {
                        // Just the title, like Claude's and ChatGPT's recents.
                        Text(thread.title ?? "New chat")
                            .font(.body)
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .listRowBackground(highlight(current.chatID == thread.id))
                    .listRowSeparator(.hidden)
                    .contextMenu {
                        if !store.showingParentView, let classes = store.classes?.classes {
                            Picker("Class", selection: Binding(
                                get: { thread.courseId },
                                set: { id in Task { await store.setCourse(thread, to: id) } }
                            )) {
                                Text("No class").tag(Int?.none)
                                ForEach(classes) { Text($0.shortName).tag(Optional($0.id)) }
                            }
                        }
                        Button("Archive", systemImage: "archivebox") {
                            Task { await store.archive(thread) }
                        }
                    }
                }
            } header: {
                Text(store.showingParentView ? "Your briefings" : "Chats")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 44)
        .safeAreaInset(edge: .top, spacing: 4) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Tuttles").font(.largeTitle.bold())
                if let kid = store.actingKid {
                    Text("\(kid.name) is using Tuttles").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .safeAreaInset(edge: .bottom) {
            HStack {
                AccountMenu(showMemory: $showingMemory)
                Spacer()
                NewChatCapsule { open(.chat(UUID(), isNew: true)) }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 8)
        }
        .refreshable {
            async let threads: Void = store.refreshThreads()
            async let classes: Void = store.refreshClasses()
            async let study: Void = store.refreshStudy()
            _ = await (threads, classes, study)
        }
        .animation(.default, value: store.threads.count)
    }

    private var threads: [TutorThread] { store.showingParentView ? store.briefings : store.kidThreads }

    /// One of the places at the top: an icon and a name, like Claude's Projects and Code.
    private func place(_ title: String, systemImage: String, _ route: Route) -> some View {
        Button { open(route) } label: {
            HStack(spacing: 14) {
                Image(systemName: systemImage)
                    .font(.body)
                    .frame(width: 26)
                Text(title)
                Spacer()
            }
            .font(.title3)
            .foregroundStyle(.primary)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .listRowBackground(highlight(current == route))
        .listRowSeparator(.hidden)
    }

    @ViewBuilder private func highlight(_ on: Bool) -> some View {
        if on {
            RoundedRectangle(cornerRadius: 14).fill(.quaternary).padding(.horizontal, 8)
        } else {
            Color.clear
        }
    }
}
