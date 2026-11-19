import AppKit
import MasonKit
import Observation
import Security
import SwiftUI

/// Keeps the family Mac's copy current. `scripts/release-mac.sh` publishes each
/// build (signed with the family Developer ID and notarized) to the public
/// app-builds bucket; this notices a newer one, and on a click downloads it,
/// checks it's really ours, swaps it in for the running copy and reopens.
/// The Mac's counterpart of MasonKit's AppUpdate, which iOS needs a different
/// way for.
@MainActor
@Observable
final class MacUpdate {
    enum Phase: Equatable {
        case none
        /// A newer build is published.
        case available(build: Int, download: URL)
        case installing
        case failed(String)
    }

    private(set) var phase: Phase = .none

    private static let latest = URL(
        string: "\(Config.supabaseURL.absoluteString)/storage/v1/object/public/app-builds/tuttles-mac/latest.json")!
    /// The family developer account, which every published build is signed by.
    private static let team = "S4AV4J8F99"
    private static let installPage = Config.website.appending(path: "install/tuttles")

    private static var ownBuild: Int? {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String).flatMap(Int.init)
    }

    func check() async {
        // Built here in Xcode it's whatever was just built.
        #if !DEBUG
        guard phase == .none || phase.isFailed, let mine = Self.ownBuild else { return }
        struct Latest: Decodable { let build: String; let download: String }
        var request = URLRequest(url: Self.latest)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let latest = try? JSONDecoder().decode(Latest.self, from: data),
              let theirs = Int(latest.build), theirs > mine,
              let download = URL(string: latest.download), download.scheme == "https"
        else { return }
        phase = .available(build: theirs, download: download)
        #endif
    }

    /// Downloads the new build and swaps it in. The app reopens as the new one.
    func install() async {
        guard case .available(_, let download) = phase else { return }
        phase = .installing
        do {
            let (zip, response) = try await URLSession.shared.download(from: download)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Problem.download }
            try await install(zip: zip)
        } catch {
            phase = .failed((error as? Problem)?.message ?? "The update didn't work. Try again later.")
        }
    }

    enum Problem: Error {
        case download, unpack, notOurs, older, cantReplace

        var message: String {
            switch self {
            case .download: "The update couldn't be downloaded. Try again later."
            case .unpack, .notOurs, .older: "That update didn't look right, so it wasn't installed."
            case .cantReplace: "Tuttles couldn't update itself here. Get the new one from family.mason.io/install/tuttles."
            }
        }
    }

    /// Unpacks a downloaded build, checks it, and puts it where this copy is.
    func install(zip: URL, checkingSignature: Bool = true) async throws {
        let work = URL.temporaryDirectory.appending(path: "tuttles-update-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: work) }
        guard await Self.run("/usr/bin/ditto", "-x", "-k", zip.path, work.path) else { throw Problem.unpack }
        guard let fresh = try FileManager.default.contentsOfDirectory(at: work, includingPropertiesForKeys: nil)
            .first(where: { $0.pathExtension == "app" }),
            let info = NSDictionary(contentsOf: fresh.appending(path: "Contents/Info.plist"))
        else { throw Problem.unpack }

        if checkingSignature {
            // Ours, untampered, and not a step back to an older build.
            guard info["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier, Self.isOurs(fresh) else { throw Problem.notOurs }
            guard let theirs = (info["CFBundleVersion"] as? String).flatMap(Int.init), let mine = Self.ownBuild, theirs > mine
            else { throw Problem.older }
        }

        let current = Bundle.main.bundleURL
        let folder = current.deletingLastPathComponent()
        // Run from the Downloads folder the Mac keeps the app somewhere it can't
        // be replaced; the install page says to move it to Applications.
        guard !current.path.contains("/AppTranslocation/"), FileManager.default.isWritableFile(atPath: folder.path) else {
            NSWorkspace.shared.open(Self.installPage)
            throw Problem.cantReplace
        }
        // Everyone with a login here is an admin: make the new copy one any of
        // them can replace next time, whoever ran this update.
        _ = await Self.run("/bin/chmod", "-R", "g+w", fresh.path)
        // The old copy steps aside under another name first, so there's never
        // a moment with no Tuttles there; it can only be renamed in place when
        // someone else installed it, and is cleared away when it can be.
        let aside = folder.appending(path: ".\(current.deletingPathExtension().lastPathComponent)-old-\(UUID().uuidString.prefix(8)).app")
        do {
            try FileManager.default.moveItem(at: current, to: aside)
        } catch {
            throw Problem.cantReplace
        }
        do {
            try FileManager.default.moveItem(at: fresh, to: current)
        } catch {
            try? FileManager.default.moveItem(at: aside, to: current)
            throw Problem.cantReplace
        }
        try? FileManager.default.removeItem(at: aside)

        // Open the new copy once this one has gone.
        let reopen = Process()
        reopen.executableURL = URL(fileURLWithPath: "/bin/sh")
        reopen.arguments = ["-c", "while kill -0 \(ProcessInfo.processInfo.processIdentifier) 2>/dev/null; do sleep 0.2; done; /usr/bin/open \"$0\"", current.path]
        try? reopen.run()
        NSApp.terminate(nil)
    }

    /// Old copies an earlier update had to leave behind (they belonged to
    /// another login): cleared by whoever can, at launch.
    static func clearOldCopies() {
        let current = Bundle.main.bundleURL
        let prefix = ".\(current.deletingPathExtension().lastPathComponent)-old-"
        let folder = current.deletingLastPathComponent()
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        for name in names where name.hasPrefix(prefix) && name.hasSuffix(".app") {
            try? FileManager.default.removeItem(at: folder.appending(path: name))
        }
    }

    /// Signed by the family Developer ID, with nothing changed since.
    private static func isOurs(_ app: URL) -> Bool {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess, let code else { return false }
        // Apple's own wording for "a Developer ID app from this team".
        let wanted = """
            anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists \
            and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "\(team)"
            """
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(wanted as CFString, [], &requirement) == errSecSuccess else { return false }
        let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSCheckNestedCode | kSecCSStrictValidate)
        return SecStaticCodeCheckValidity(code, flags, requirement) == errSecSuccess
    }

    private static func run(_ tool: String, _ arguments: String...) async -> Bool {
        await withCheckedContinuation { done in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: tool)
            process.arguments = arguments
            process.terminationHandler = { done.resume(returning: $0.terminationStatus == 0) }
            do { try process.run() } catch { done.resume(returning: false) }
        }
    }
}

private extension MacUpdate.Phase {
    var isFailed: Bool { if case .failed = self { true } else { false } }
}

/// At the foot of the sidebar when a newer build is out: one click updates.
struct MacUpdateButton: View {
    @State private var update = MacUpdate()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        // A stack, not a group: it's there (and checking) even while it shows nothing.
        VStack(spacing: 0) {
            switch update.phase {
            case .none:
                EmptyView()
            case .available:
                Button { Task { await update.install() } } label: {
                    Label("Update Tuttles", systemImage: "arrow.down.circle.fill")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.tint(TuttlesLook.accent).interactive(), in: .capsule)
                .help("A new version of Tuttles is ready. It reopens by itself; your chats stay.")
            case .installing:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Updating…").font(.callout).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            case .failed(let message):
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .animation(.default, value: update.phase)
        .task {
            MacUpdate.clearOldCopies()
            await update.check()
            #if DEBUG
            // `--update-from=<zip>`: swap in a build from a file, to try the swap itself.
            if let zip = Launch.value("update-from") {
                try? await update.install(zip: URL(fileURLWithPath: zip), checkingSignature: false)
            }
            #endif
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await update.check() } }
        }
    }
}
