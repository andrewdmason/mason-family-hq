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
    static let uploadSessionID = "io.mason.clipscamera.uploads"
}
