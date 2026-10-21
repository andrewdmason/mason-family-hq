import Foundation

/// Where Family HQ lives. The publishable key is public by design (the website
/// ships the same one to every browser); access is governed by sign-in and
/// row-level security.
public enum Config {
    public static let supabaseURL = URL(string: "https://evemrivkogdwmrgrdayc.supabase.co")!
    public static let supabaseKey = "sb_publishable_Nac9Y4sdQ03Zli4QcPsPCQ_2FEF0opM"
    /// Google sign-in returns to the app that asked, at
    /// `<bundle id>://auth-callback` (io.mason.practice://auth-callback for
    /// Practice). Each app registers that URL scheme, and each one must be in
    /// Supabase › Authentication › URL Configuration › Redirect URLs.
    public static let authRedirect = URL(string: "\(Bundle.main.bundleIdentifier ?? "io.mason")://auth-callback")!
    /// The keychain group every family app shares, so signing in to one signs
    /// in to all of them. Each app lists it in keychain-access-groups.
    public static let sharedKeychainGroup = "S4AV4J8F99.io.mason.shared"
    public static let website = URL(string: "https://family.mason.io")!
}
