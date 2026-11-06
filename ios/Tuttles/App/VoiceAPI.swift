import Foundation
import MasonKit
import Supabase

/// The website routes behind push to talk and voice mode
/// (src/app/(tuttles)/tuttles/api/transcribe and …/voice/*). Each carries the
/// phone's access token, like the chat route.
extension ChatStore {
    /// Push to talk: what was said, written out.
    func transcribe(_ audio: Data) async throws -> String {
        let data = try await post("tuttles/api/transcribe", body: audio, contentType: "audio/mp4")
        struct Reply: Decodable { let text: String }
        return try JSONDecoder().decode(Reply.self, from: data).text
    }

    struct VoiceKey: Decodable { let key: String; let model: String }

    /// A short-lived key for one live voice call, already set up with the
    /// tutor's instructions for this chat.
    func voiceKey(threadID: UUID, assignmentID: Int?) async throws -> VoiceKey {
        var body: [String: Any] = ["threadId": threadID.uuidString.lowercased()]
        if let assignmentID { body["assignmentId"] = assignmentID }
        let data = try await post("tuttles/api/voice/session", json: body)
        return try JSONDecoder().decode(VoiceKey.self, from: data)
    }

    /// Uploads a photo into a chat's folder and returns its path.
    func upload(_ photo: ChatPhoto, threadID: UUID) async throws -> String {
        guard let userID = Session.shared.userID else { throw SendError.notSignedIn }
        let path = "\(userID.uuidString.lowercased())/\(threadID.uuidString.lowercased())/\(photo.id.uuidString.lowercased()).jpg"
        _ = try await client.storage.from("tuttles")
            .upload(path, data: photo.jpeg, options: FileOptions(contentType: "image/jpeg", upsert: true))
        rememberPhoto(photo.image, at: path)
        return path
    }

    /// An exact write-up of an uploaded homework photo, for the voice tutor.
    func readPhoto(at path: String) async throws -> String {
        let data = try await post("tuttles/api/voice/look", json: ["path": path])
        struct Reply: Decodable { let reading: String }
        return try JSONDecoder().decode(Reply.self, from: data).reading
    }

    struct VoiceTurn: Encodable {
        let role: String
        var text: String
        var images: [String] = []
        var visuals: [String] = []
    }

    /// Saves a finished call into its chat.
    func saveVoice(threadID: UUID, assignmentID: Int?, turns: [VoiceTurn]) async throws {
        struct Body: Encodable { let threadId: String; let assignmentId: Int?; let turns: [VoiceTurn] }
        let body = try JSONEncoder().encode(Body(threadId: threadID.uuidString.lowercased(), assignmentId: assignmentID, turns: turns))
        _ = try await post("tuttles/api/voice/save", body: body, contentType: "application/json")
    }

    private func post(_ route: String, json: [String: Any]) async throws -> Data {
        try await post(route, body: try JSONSerialization.data(withJSONObject: json), contentType: "application/json")
    }

    private func post(_ route: String, body: Data, contentType: String) async throws -> Data {
        let token = try await client.auth.session.accessToken
        var request = URLRequest(url: Self.websiteURL.appending(path: route))
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw SendError.server(message ?? "Tuttles couldn't be reached.")
        }
        return data
    }
}
