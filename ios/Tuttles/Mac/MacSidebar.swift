import MasonKit
import SwiftUI

/// The sidebar: a new chat at the top, Classes and Study under it, then the
/// chats, with whoever's signed in along the bottom. It's the iPhone's
/// slide-out menu (iPhone/SideMenu.swift), always out.
struct MacSidebar: View {
    /// What's open, to highlight it.
    let current: Route
    @Binding var showingMemory: Bool
    let open: (Route) -> Void
    @Environment(ChatStore.self) private var store

    /// A row that can be the one open.
    private enum Item: Hashable {
        case week, classes, study
        case thread(UUID)
    }

    private var selection: Binding<Item?> {
        Binding {
            switch current {
            case .week: .week
            case .classes, .classPage: .classes
            case .study, .studySet: .study
            case .chat(let id, _, _, _, _, _): .thread(id)
            case .topic: nil
            }
        } set: { item in
            switch item {
            case .week: open(.week)
            case .classes: open(.classes)
            case .study: open(.study)
            case .thread(let id): open(.chat(id, isNew: false))
            case nil: break
            }
        }
    }

    var body: some View {
        List(selection: selection) {
            Section {
                if store.showingParentView {
                    place("This week", "calendar").tag(Item.week)
                } else {
                    place("Classes", "books.vertical").tag(Item.classes)
                    place("Study", "checklist").tag(Item.study)
                }
            }
            Section(store.showingParentView ? "Your briefings" : "Chats") {
                if !store.threadsLoaded {
                    ForEach(0..<4, id: \.self) { _ in
                        Text("Loading a chat title").redacted(reason: .placeholder)
                    }
                    .selectionDisabled()
                }
                if let error = store.listError {
                    Text(error).foregroundStyle(.secondary).selectionDisabled()
                } else if store.threadsLoaded, threads.isEmpty {
                    Text(store.showingParentView ? "No briefings yet" : "No chats yet")
                        .foregroundStyle(.secondary)
                        .selectionDisabled()
                }
                ForEach(threads) { thread in
                    Text(thread.title ?? "New chat")
                        .lineLimit(1)
                        .tag(Item.thread(thread.id))
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
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if !store.showingParentView {
                Button { open(.chat(UUID(), isNew: true)) } label: {
                    Label("New chat", systemImage: "square.and.pencil")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 9)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.tint(TuttlesLook.accent).interactive(), in: .capsule)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .help("New chat (⌘N)")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                MacUpdateButton()
                MacAccountMenu(showMemory: $showingMemory)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .animation(.default, value: store.threads.count)
    }

    /// One of the places at the top, its icon in the app's red rather than the Mac's blue.
    private func place(_ title: String, _ systemImage: String) -> some View {
        Label { Text(title) } icon: { Image(systemName: systemImage).foregroundStyle(TuttlesLook.accent) }
    }

    private var threads: [TutorThread] { store.showingParentView ? store.briefings : store.kidThreads }
}

/// Who's using Tuttles, at the foot of the sidebar: a parent switches between
/// their own view and each kid's here, as on the phone.
struct MacAccountMenu: View {
    @Binding var showMemory: Bool
    @Environment(ChatStore.self) private var store

    var body: some View {
        @Bindable var store = store
        Menu {
            if store.isParent {
                Picker("View", selection: $store.viewer) {
                    ForEach(store.kids) { kid in
                        Label(kid.name, systemImage: "person.fill").tag(ChatStore.Viewer.kid(kid.id))
                    }
                    Label("Parent view", systemImage: "person.2").tag(ChatStore.Viewer.parent)
                }
                .pickerStyle(.inline)
            }
            Button(store.showingParentView ? "What Tuttles knows about \(store.classes?.student.name ?? "them")" : "What Tuttles knows about you",
                   systemImage: "brain.head.profile") { showMemory = true }
            Section(Session.shared.email ?? "Signed in") {
                Button("Sign out", role: .destructive) { Task { await Session.shared.signOut() } }
            }
        } label: {
            HStack(spacing: 10) {
                Text(store.initials)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(TuttlesLook.accent.gradient, in: .circle)
                VStack(alignment: .leading, spacing: 0) {
                    Text(who).font(.callout.weight(.medium)).lineLimit(1)
                    if let kid = store.actingKid {
                        Text("\(kid.name) is using Tuttles").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    } else if store.showingParentView {
                        Text("Parent view").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .contentShape(.rect)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 14))
        .accessibilityLabel("Account")
    }

    private var who: String {
        store.actingKid?.name ?? Session.shared.name ?? Session.shared.email ?? "Tuttles"
    }
}
