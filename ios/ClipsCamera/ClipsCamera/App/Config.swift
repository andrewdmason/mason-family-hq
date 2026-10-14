import Foundation

/// Where Clips lives. The publishable key is public by design (the website
/// ships the same one to every browser); access is governed by sign-in and
/// row-level security.
enum Config {
    static let supabaseURL = URL(string: "https://evemrivkogdwmrgrdayc.supabase.co")!
    static let supabaseKey = "sb_publishable_Nac9Y4sdQ03Zli4QcPsPCQ_2FEF0opM"
    /// Google sign-in returns here. Must be in Supabase › Authentication ›
    /// URL Configuration › Redirect URLs.
    static let authRedirect = URL(string: "io.mason.clipscamera://auth-callback")!
    static let bucket = "baseball-clips"
    /// Watch-only Clips for whoever isn't signed in (a coach on TestFlight).
    static let viewerAPI: URL = {
        #if DEBUG
        // `-viewerAPI http://localhost:PORT/clips/api/viewer`: a local server.
        if let local = UserDefaults.standard.string(forKey: "viewerAPI").flatMap(URL.init(string:)) { return local }
        #endif
        return URL(string: "https://family.mason.io/clips/api/viewer")!
    }()
    /// The key for it, built in by scripts/release.sh from the database (it's
    /// not in the repo). Builds without one ask everyone to sign in.
    static let viewerKey: String? = {
        let key = Bundle.main.object(forInfoDictionaryKey: "ClipsViewerKey") as? String ?? ""
        return key.isEmpty || key.hasPrefix("$(") ? nil : key
    }()
    static let uploadSessionID = "io.mason.clipscamera.uploads"
}
