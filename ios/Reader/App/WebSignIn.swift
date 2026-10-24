import Foundation
import MasonKit
import WebKit

/// Signs the web views in to family.mason.io with the app's own sign-in, so
/// the reading screen never shows a second login.
///
/// The website keeps its session in a cookie. When the web views' cookie store
/// has none (first run, or after it expired), the first page loads through the
/// website's native hand-off instead: a form POST of the app's access token to
/// /auth/native-handoff, which answers with a session cookie of the web views'
/// own and a redirect to the page asked for. A session of its own, not a copy
/// of the app's: Supabase revokes a session whose refresh token is replayed, so
/// two clients sharing one would sign each other out.
@MainActor
enum WebSignIn {
    static let website = Config.website

    /// The website's Supabase cookie (`sb-<project>-auth-token`, possibly split
    /// into `.0`, `.1`… chunks) is in the web views' store.
    static func hasWebSession() async -> Bool {
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        return cookies.contains { cookie in
            website.host().map { cookie.domain.hasSuffix($0) } == true
                && cookie.name.hasPrefix("sb-")
                && cookie.name.contains("-auth-token")
                && (cookie.expiresDate.map { $0 > .now } ?? true)
        }
    }

    /// A plain GET of `path` when the web views are signed in, otherwise the
    /// hand-off POST that signs them in and lands on `path`.
    static func request(for path: String) async -> URLRequest {
        let url = URL(string: path, relativeTo: website)!.absoluteURL
        if await hasWebSession() { return URLRequest(url: url) }
        return await handoff(next: path) ?? URLRequest(url: url)
    }

    /// The hand-off POST, or nil when the app itself isn't signed in.
    static func handoff(next path: String) async -> URLRequest? {
        guard let token = try? await Session.shared.client.auth.session.accessToken else { return nil }
        var request = URLRequest(url: website.appending(path: "auth/native-handoff"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var form = URLComponents()
        form.queryItems = [
            URLQueryItem(name: "access_token", value: token),
            URLQueryItem(name: "next", value: path),
        ]
        // Form encoding: URLComponents leaves "+" alone, which a form decodes
        // as a space.
        request.httpBody = form.percentEncodedQuery?
            .replacingOccurrences(of: "+", with: "%2B")
            .data(using: .utf8)
        return request
    }

    /// Signing out of the app signs the web views out too.
    static func signOut() async {
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
    }
}
