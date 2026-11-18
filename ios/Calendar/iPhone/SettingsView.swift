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
                    Toggle("Show hidden events", isOn: $prefs.showHidden)
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
