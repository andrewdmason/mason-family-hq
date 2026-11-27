import MasonKit
import SwiftUI

/// How the calendar looks on this phone. Setting calendars up (sources,
/// TeamSnap, drive times) stays on the website, a tap away.
struct SettingsView: View {
    let me: String?
    @Environment(CalendarStore.self) private var store
    @Environment(Prefs.self) private var prefs
    @Environment(\.dismiss) private var dismiss
    @State private var syncing = false
    @State private var showHiddenEvents = false

    var body: some View {
        @Bindable var prefs = prefs
        NavigationStack {
            Form {
                Section {
                    ForEach(prefs.ordered(store.board.members)) { member in
                        Toggle(isOn: Binding(
                            get: { !prefs.hidden.contains(member.email) },
                            set: { shown in
                                if shown { prefs.hidden.remove(member.email) } else { prefs.hidden.insert(member.email) }
                            }
                        )) {
                            HStack(spacing: 10) {
                                Avatar(member: member, size: 28)
                                Text(member.firstName + (member.email == me ? " (you)" : ""))
                            }
                        }
                    }
                    .onMove { from, to in
                        var emails = prefs.ordered(store.board.members).map(\.email)
                        emails.move(fromOffsets: from, toOffset: to)
                        prefs.order = emails
                    }
                } header: {
                    Text("People")
                } footer: {
                    Text("Drag to reorder. Your own column always comes first in the Day view.")
                }

                Section("Day view") {
                    Picker("Other people", selection: $prefs.othersAsBlocks) {
                        Text("Pins").tag(false)
                        Text("Blocks").tag(true)
                    }
                }

                Section {
                    // A button, not a link: the form is always in edit mode
                    // (for reordering people), where links don't answer.
                    Button {
                        showHiddenEvents = true
                    } label: {
                        HStack {
                            Text("Hidden events").foregroundStyle(.primary)
                            Spacer()
                            Text(store.hides.isEmpty ? "None" : "\(store.hides.count)").foregroundStyle(.secondary)
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    Toggle("Show hidden events", isOn: $prefs.showHidden)
                } footer: {
                    Text("Touch and hold an event to hide it from your view. Showing hidden events brings back, dimmed, the ones you've hidden and the ones nobody's going to.")
                }

                Section {
                    Toggle("Show time between events", isOn: $prefs.timeBetween)
                } footer: {
                    Text("Schedule and the widget list your own events and the time between them, with what the family has on in that time on one grey line to tap open. Off, they show every event.")
                }

                Section {
                    Picker("Open on", selection: $prefs.opensOn) {
                        ForEach(ViewMode.allCases) { Text($0.title).tag($0) }
                    }
                }

                Section {
                    Button {
                        syncing = true
                        Task {
                            await store.sync()
                            syncing = false
                        }
                    } label: {
                        HStack {
                            Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
                            Spacer()
                            if syncing { ProgressView() }
                        }
                    }
                    .disabled(syncing || store.isDemo)
                    Link(destination: CalendarAPI.website.appending(path: "settings/calendars")) {
                        Label("Manage calendars", systemImage: "safari")
                    }
                } footer: {
                    Text(updated)
                }

                Section {
                    if !store.isDemo {
                        LabeledContent("Signed in", value: Session.shared.email ?? "")
                        Button("Sign out", role: .destructive) {
                            Task {
                                await Session.shared.signOut()
                                store.forget()
                            }
                        }
                    }
                    LabeledContent("Version", value: version)
                }
            }
            .environment(\.editMode, .constant(.active))
            .navigationDestination(isPresented: $showHiddenEvents) { HiddenEventsView() }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var updated: String {
        if store.offline {
            guard let at = store.lastUpdated else { return "Offline." }
            return "Offline. Last updated \(at.formatted(.relative(presentation: .named)))."
        }
        guard let at = store.lastUpdated else { return "Calendars are set up on the website." }
        return "Updated \(at.formatted(.relative(presentation: .named))). Calendars are set up on the website."
    }

    private var version: String {
        let info = Bundle.main.infoDictionary
        return "\(info?["CFBundleShortVersionString"] as? String ?? "") (\(info?["CFBundleVersion"] as? String ?? ""))"
    }
}
