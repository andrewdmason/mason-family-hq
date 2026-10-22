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
            flowType: .pkce,
            // Open on the keychain's sign-in straight away; an expired one is
            // renewed in the background rather than on the launch screen.
            emitLocalSessionAsInitialSession: true
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
            if user?.id != userID { role = user.flatMap { Self.savedRole(for: $0.id) } }
            userID = user?.id
            email = user?.email
            guard let id = user?.id else {
                checked = true
                continue
            }
            // The role last seen on this phone lets the app open at once; the
            // server's answer follows. Only a first sign-in waits for it.
            if role != nil { checked = true }
            await loadRole(id)
            checked = true
        }
    }

    private static func roleKey(_ id: UUID) -> String { "session.role.\(id.uuidString.lowercased())" }

    private static func savedRole(for id: UUID) -> String? {
        UserDefaults.standard.string(forKey: roleKey(id))
    }

    private func loadRole(_ id: UUID) async {
        struct Row: Decodable { let role: String? }
        // No answer (no signal) keeps the role we had.
        guard let rows: [Row] = try? await client.from("family_members")
            .select("role")
            .eq("user_id", value: id.uuidString.lowercased())
            .limit(1)
            .execute()
            .value,
            id == userID
        else { return }
        role = rows.first?.role
        UserDefaults.standard.set(role, forKey: Self.roleKey(id))
    }

    public func signIn() async throws {
        try await client.auth.signInWithOAuth(provider: .google, redirectTo: Config.authRedirect)
    }

    public func signOut() async {
        try? await client.auth.signOut()
    }
}
