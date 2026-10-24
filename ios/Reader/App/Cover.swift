import CryptoKit
import MasonKit
import SwiftUI

/// A book's cover, kept on disk so the shelf shows its covers with no signal.
/// cover_image_url is an Open Library or article image URL, or the EPUB's own
/// cover inline as a data: URL.
struct Cover: View {
    let book: ShelfBook
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                placeholder
            }
        }
        .aspectRatio(2 / 3, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(.black.opacity(0.08)))
        .task(id: book.cover_image_url) { image = await CoverCache.image(for: book.cover_image_url) }
    }

    private var placeholder: some View {
        ZStack {
            Theme.paper
            VStack(spacing: 6) {
                Image(systemName: book.isArticle ? "doc.text" : "book.closed")
                    .font(.title2)
                    .foregroundStyle(Theme.accent.opacity(0.6))
                Text(book.isArticle ? (book.site_name ?? book.title) : book.title)
                    .font(.system(.caption2, design: .serif))
                    .multilineTextAlignment(.center)
                    .lineLimit(4)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
            }
        }
    }
}

enum CoverCache {
    private static let folder = URL.cachesDirectory.appending(path: "covers")
    private static let memory = NSCache<NSString, UIImage>()

    static func image(for urlString: String?) async -> UIImage? {
        guard let urlString, let url = URL(string: urlString) else { return nil }
        let key = SHA256.hash(data: Data(urlString.utf8)).map { String(format: "%02x", $0) }.joined()
        if let hit = memory.object(forKey: key as NSString) { return hit }
        let file = folder.appending(path: key)
        if let data = try? Data(contentsOf: file), let image = UIImage(data: data) {
            memory.setObject(image, forKey: key as NSString)
            return image
        }
        guard let (data, _) = try? await URLSession.shared.data(from: url), let image = UIImage(data: data) else { return nil }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? data.write(to: file)
        memory.setObject(image, forKey: key as NSString)
        return image
    }
}
