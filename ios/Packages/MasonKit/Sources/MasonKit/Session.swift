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
            storage: Session.storage,
            redirectToURL: Config.authRedirect,
            flowType: .pkce,
            // Open on the keychain's sign-in straight away; an expired one is
            // renewed in the background rather than on the launch screen.
            emitLocalSessionAsInitialSession: true
        ))
    )

    #if os(macOS)
    /// A Mac app built here isn't signed with the Apple account the shared keychain
    /// needs, so its sign-in sits in a file only this user account can read.
    private static let storage: any AuthLocalStorage = SessionFile()
    #else
    private static let storage: any AuthLocalStorage = KeychainLocalStorage(accessGroup: Config.sharedKeychainGroup)
    #endif

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

#if os(macOS)
private struct SessionFile: AuthLocalStorage {
    private func url(_ key: String) throws -> URL {
        let folder = URL.applicationSupportDirectory.appending(path: Bundle.main.bundleIdentifier ?? "io.mason")
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return folder.appending(path: "session-\(key).json")
    }

    func store(key: String, value: Data) throws {
        let file = try url(key)
        try value.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }

    func retrieve(key: String) throws -> Data? {
        try? Data(contentsOf: url(key))
    }

    func remove(key: String) throws {
        try? FileManager.default.removeItem(at: url(key))
    }
}
#endif
