import Foundation

// Who's in the game and what colours they come in. Math had a shop of skins
// once; what it pays is spent on the house now (iPhone/House), and everyone
// runs as themselves, with a look of their own that's free to change.

enum MathCast {
    /// Ms. Grey: she has always been your teacher. Check the photographs.
    static let teacherID = "teacher-grey"
    static let teacher = MathLook(head: "female-d", body: "female-d", hair: "6d6d6d", skin: "f0c8a8", top: "6b6f76", bottom: "3a3c40", shoes: "1a1a1a")
    static let teacherHeight: Float = 1.95

    /// Colours offered in the look editor.
    static let hairs = ["c0531f", "e07a3a", "8a5a34", "5a3a22", "2b1d14", "101010", "d9b25f", "f1e0a0", "9a9aa0", "2e86c1", "8e44ad", "2ecc71", "ff2d95"]
    static let skins = ["fbe0cc", "f6c9a8", "f3c6a2", "e8b48c", "c98a5e", "a56a43", "8d5a3a", "6b4226", "4a2e1c"]
    static let clothes = ["1f3a6b", "d6263a", "f4f6f7", "20242c", "2e86c1", "27ae60", "f1c40f", "e67e22", "8e44ad", "ff6fb5", "16a085", "c9b48a", "7f8c8d", "6b4f1d"]
}
