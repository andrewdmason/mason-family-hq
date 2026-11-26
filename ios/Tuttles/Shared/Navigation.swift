import MasonKit
import SwiftUI

// What both apps share of getting around: the look, the places there are to
// go, and the screens that are the same on the iPhone and the Mac.

enum TuttlesLook {
    /// Hydrant red, from the app icon.
    static let accent = Color(red: 0.84, green: 0.15, blue: 0.12)
}

/// The red "New chat" capsule.
struct NewChatCapsule: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("New chat", systemImage: "square.and.pencil")
                .font(.headline)
                .foregroundStyle(.white)
                .padding(.horizontal, 22)
                .padding(.vertical, 14)
        }
        .glassEffect(.regular.tint(TuttlesLook.accent).interactive(), in: .capsule)
        .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
    }
}

/// The "New chat" button, floating at the bottom of a list where a thumb can reach it.
struct NewChatButton: ViewModifier {
    let action: () -> Void

    func body(content: Content) -> some View {
        content
            .safeAreaInset(edge: .bottom) {
                NewChatCapsule(action: action)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
            }
    }
}

extension View {
    func newChatButton(action: @escaping () -> Void) -> some View {
        modifier(NewChatButton(action: action))
    }
}

enum Route: Hashable {
    /// `isNew`: a chat with nothing in it yet, whose id is made here. A new
    /// chat can be about an assignment (`start`) or begun from a class page,
    /// or be a quiz on a study set (`quiz`).
    case chat(UUID, isNew: Bool, start: ChatStart? = nil, courseID: Int? = nil, briefing: BriefingTopic? = nil,
              quiz: QuizStart? = nil)
    /// A study set's page (Study.swift).
    case studySet(String)
    case classPage(Int)
    /// Parent view: one of the kid's topics this week.
    case topic(WeekPayload.Topic, WeekPayload.ClassWeek)
    /// From the menu: the class list, the study sets, and a parent's This week.
    case classes
    case study
    case week
    /// ISEE vocabulary practice (Vocab.swift), for a kid and for the parents.
    case vocab
    /// Every word: their own, or one of the kids' (with their name) from the parents' view.
    case vocabList(kid: UUID?, name: String?)
    /// How a kid is doing, off their path: today, the words mastered, the ones giving trouble.
    case vocabProgress
    /// ISEE math practice as an endless runner (iPhone/Math), for a kid, and
    /// how the kids are doing at it, for the parents. iPhone only.
    case math
    /// The house each kid builds with what Vocab and Math pay (iPhone/House),
    /// and both houses, for the parents. iPhone only.
    case house
    /// The Parent Dashboard's own page: each kid's last four weeks, and the
    /// words to practice with them today (ParentDashboard.swift).
    case dashboard

    /// The chat this route opens, if it's one.
    var chatID: UUID? {
        if case .chat(let id, _, _, _, _, _) = self { return id }
        return nil
    }
}

/// The class list, from the menu.
struct ClassesListView: View {
    @Binding var path: [Route]
    @Environment(ChatStore.self) private var store

    var body: some View {
        PageList {
            if let classes = store.classes?.classes, !classes.isEmpty {
                Section {
                    ForEach(classes) { info in
                        NavigationLink(value: Route.classPage(info.id)) {
                            HStack(spacing: 12) {
                                RoundedRectangle(cornerRadius: 3).fill(info.tint).frame(width: 6, height: 28)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(info.shortName).font(.body.weight(.medium))
                                    if let unit = info.unit {
                                        Text(unit.name).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                }
                                Spacer()
                                let newFeedback = info.feedback.filter(\.isNew).count
                                if newFeedback > 0 {
                                    Text("\(newFeedback) new")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 7).padding(.vertical, 2)
                                        .background(TuttlesLook.accent, in: .capsule)
                                }
                            }
                        }
                    }
                }
            } else if !store.classesLoaded {
                ClassesPlaceholder()
            }
        }
        .overlay {
            if store.classesLoaded, store.classes?.classes.isEmpty ?? true {
                ContentUnavailableView("No classes yet", systemImage: "books.vertical",
                                       description: Text("Once Canvas is connected, your classes show up here."))
            }
        }
        .navigationTitle("Classes")
        .refreshable { await store.refreshClasses() }
        .animation(.default, value: store.classes?.classes.count)
    }
}

extension View {
    /// While a parent's phone is being used as a kid, the kid's name sits under
    /// the title, so nobody chats as them by mistake.
    @ViewBuilder func kidUsing(_ kid: FamilyKid?) -> some View {
        if let kid {
            navigationSubtitle("\(kid.name) is using Tuttles")
        } else {
            self
        }
    }
}

extension ChatStore {
    /// Whoever the app is being used as: the kid it's being used as, or whoever's
    /// signed in ("AM" for Andrew Mason).
    var initials: String {
        guard let name = actingKid?.name ?? Session.shared.name else {
            return Session.shared.email?.first.map { String($0).uppercased() } ?? "?"
        }
        let words = name.split(separator: " ")
        let letters = [words.first, words.count > 1 ? words.last : nil].compactMap { $0?.first }
        return letters.isEmpty ? "?" : String(letters).uppercased()
    }
}
