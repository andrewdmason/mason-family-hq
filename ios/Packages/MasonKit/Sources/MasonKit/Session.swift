import Foundation
import Observation
import Supabase

/// Who's signed in, and what they're allowed into. One Google sign-in through
/// the family Supabase, the same account as family.mason.io, kept in the
/// keychain group all the family apps share: sign in to one and the others
/// open signed in.
@MainActor
@Observable
public final class Session {
    public static let shared = Session()

    public let client = SupabaseClient(
        supabaseURL: Config.supabaseURL,
        supabaseKey: Config.supabaseKey,
        options: SupabaseClientOptions(auth: .init(
            storage: KeychainLocalStorage(accessGroup: Config.sharedKeychainGroup),
            redirectToURL: Config.authRedirect,
            flowType: .pkce
        ))
    )

    public private(set) var userID: UUID?
    public private(set) var email: String?
    /// family_members.role: owner, parent, kid… Nil until it's loaded, or for
    /// an account that isn't in the family.
    public private(set) var role: String?
    /// False until the stored session has been checked at launch.
    public private(set) var checked = false

    public var isSignedIn: Bool { userID != nil }

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

    public func signIn() async throws {
        try await client.auth.signInWithOAuth(provider: .google, redirectTo: Config.authRedirect)
    }

    public func signOut() async {
        try? await client.auth.signOut()
    }
}
