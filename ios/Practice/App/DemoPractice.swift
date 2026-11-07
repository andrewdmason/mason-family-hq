import Foundation

/// A made-up day of practice for `--demo` (the simulator, with no sign-in):
/// some technique, a piece, a trio by movement, and a maintenance rotation.
enum DemoPractice {
    struct Day {
        var pieces: [Piece]
        var works: [Work]
        var tasks: [PracticeTask]
        var lastPracticed: [UUID: String]
    }

    static func make(today: String, now: Date = .now) -> Day {
        let trio = Work(id: UUID(), name: "Piano Trio No. 1 in D minor")
        func piece(_ name: String, _ composer: String?, kind: String = "piece", maintenance: Bool = false, work: UUID? = nil) -> Piece {
            Piece(id: UUID(), workID: work, name: name, composer: composer, kind: kind, maintenance: maintenance)
        }
        let scales = piece("Scales & arpeggios", nil, kind: "technique")
        let sight = piece("Sight reading", nil, kind: "sight_reading")
        let bach = piece("Suite No. 1 — Prélude", "J. S. Bach")
        let movements = [
            piece("I. Molto allegro agitato", "Mendelssohn", work: trio.id),
            piece("II. Andante con moto tranquillo", "Mendelssohn", work: trio.id),
            piece("III. Scherzo", "Mendelssohn", work: trio.id),
            piece("IV. Finale", "Mendelssohn", work: trio.id),
        ]
        let swan = piece("The Swan", "Saint-Saëns", maintenance: true)
        let elegie = piece("Élégie", "Fauré", maintenance: true)
        let salut = piece("Salut d'amour", "Elgar", maintenance: true)
        let sonata = piece("Sonata in E minor", "Brahms", maintenance: true)

        func task(_ piece: Piece, goal: Int, done: Int, text: String = "", completed: Bool = false) -> PracticeTask {
            var t = PracticeTask(
                id: UUID(), pieceID: piece.id, timerSeconds: goal * 60, timerRemainingSeconds: (goal - done) * 60,
                completed: completed, startedAt: done > 0 ? now.addingTimeInterval(-3600) : nil,
                endedAt: done > 0 ? now.addingTimeInterval(-3600 + Double(done * 60)) : nil,
                createdAt: now.addingTimeInterval(-7200), sessionNumber: 1
            )
            t.text = text
            return t
        }

        func daysAgo(_ n: Int) -> String {
            PracticeDay.today(now.addingTimeInterval(-Double(n) * 86_400))
        }

        return Day(
            pieces: [scales, sight, bach] + movements + [swan, elegie, salut, sonata],
            works: [trio],
            tasks: [
                task(scales, goal: 15, done: 15, text: "Three octaves, D major and B minor", completed: true),
                task(bach, goal: 20, done: 8, text: "Bars 22–37: even sixteenths, let the bass ring"),
                task(movements[1], goal: 15, done: 6),
                task(salut, goal: 0, done: 4),
            ],
            lastPracticed: [
                sight.id: daysAgo(2), bach.id: daysAgo(1), movements[0].id: daysAgo(3), movements[2].id: daysAgo(5),
                swan.id: daysAgo(9), elegie.id: daysAgo(4), salut.id: today, sonata.id: daysAgo(14),
            ]
        )
    }
}
