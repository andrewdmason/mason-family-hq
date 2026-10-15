import Foundation
import Observation
import Supabase

/// Who's signed in, and what they're allowed into. One Google sign-in through
/// the family Supabase, the same account as family.mason.io.
@MainActor
@Observable
final class Session {
    static let shared = Session()

    let client = SupabaseClient(
        supabaseURL: Config.supabaseURL,
        supabaseKey: Config.supabaseKey,
        options: SupabaseClientOptions(auth: .init(redirectToURL: Config.authRedirect, flowType: .pkce))
    )

    private(set) var userID: UUID?
    private(set) var email: String?
    /// family_members.role: owner, parent, kid… Nil until it's loaded, or for
    /// an account that isn't in the family.
    private(set) var role: String?
    /// False until the stored session has been checked at launch.
    private(set) var checked = false

    var isSignedIn: Bool { userID != nil }

    private init() {
        Task { await watchAuth() }
    }

    private func watchAuth() async {
        for await (_, session) in client.auth.authStateChanges {
            let user = session?.user
            if user?.id != userID { role = nil }
            userID = user?.id
            email = user?.email
            if let id = user?.id { await loadRole(id) }
            checked = true
        }
    }

    private func loadRole(_ id: UUID) async {
        struct Row: Decodable { let role: String? }
        let rows: [Row]? = try? await client.from("family_members")
            .select("role")
            .eq("user_id", value: id.uuidString.lowercased())
            .limit(1)
            .execute()
            .value
        role = rows?.first?.role
    }

    func signIn() async throws {
        try await client.auth.signInWithOAuth(provider: .google, redirectTo: Config.authRedirect)
    }

    func signOut() async {
        try? await client.auth.signOut()
    }
}
