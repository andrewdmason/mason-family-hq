import EventKit
import Foundation

// Moves plain reminders from the default Reminders list to the Inbox (ReminderRules
// says which). A reminder is only removed once its to-do is safely on disk, so a
// crash partway can't lose one: the next sweep finds the same id and just finishes
// the removal. Sync takes it from there.

@MainActor
final class RemindersImport {
    private let store: TodoStore
    private let events = EKEventStore()
    private var isSweeping = false
    private var sweepAgain = false
    private var timer: Timer?

    init(store: TodoStore) {
        self.store = store
    }

    func start() {
        Task {
            guard (try? await events.requestFullAccessToReminders()) == true else {
                fputs("todos: no access to Reminders\n", stderr)
                return
            }
            NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: events, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.sweep() }
            }
            // iCloud's changes don't always announce themselves to a background app.
            timer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.sweep() }
            }
            sweep()
        }
    }

    func sweep() {
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else { return }
        guard !isSweeping else {
            sweepAgain = true
            return
        }
        guard let list = events.defaultCalendarForNewReminders(), list.allowsContentModifications else { return }
        isSweeping = true
        let predicate = events.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [list])
        events.fetchReminders(matching: predicate) { [weak self] found in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.move(found ?? [])
                    self.isSweeping = false
                    if self.sweepAgain {
                        self.sweepAgain = false
                        self.sweep()
                    }
                }
            }
        }
    }

    private func move(_ reminders: [EKReminder]) {
        let moving = reminders.filter {
            ReminderRules.shouldMove(
                title: $0.title, hasDate: $0.dueDateComponents != nil || $0.startDateComponents != nil,
                hasAlarm: $0.hasAlarms, repeats: $0.hasRecurrenceRules)
        }
        guard !moving.isEmpty else { return }
        // Oldest first, so the newest ends up at the top of the Inbox.
        let oldestFirst = moving.sorted { ($0.creationDate ?? .distantPast) < ($1.creationDate ?? .distantPast) }
        let items = oldestFirst.map { reminder -> (reminder: EKReminder, id: String) in
            (reminder, ReminderRules.todoID(forReminder: reminder.calendarItemExternalIdentifier ?? reminder.calendarItemIdentifier))
        }
        for item in items {
            store.addFromReminder(
                id: item.id, title: item.reminder.title ?? "", notes: item.reminder.notes,
                createdAt: item.reminder.creationDate ?? Date())
        }
        store.saveToDiskNow()
        for item in items {
            do {
                try events.remove(item.reminder, commit: false)
            } catch {
                fputs("todos: couldn't remove a reminder: \(error)\n", stderr)
            }
        }
        do {
            try events.commit()
        } catch {
            events.reset()
            fputs("todos: couldn't save Reminders: \(error)\n", stderr)
        }
    }
}
