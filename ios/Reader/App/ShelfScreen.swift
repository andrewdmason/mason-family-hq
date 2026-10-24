import MasonKit
import SwiftUI

enum Route: Hashable {
    /// The website's reading screen for a book or article.
    case book(UUID)
    /// One of the Reader pages that stay web.
    case page(WebPage)
}

enum WebPage: String, Hashable {
    case addBook, discover, settings

    var path: String {
        switch self {
        // The add-a-book dialog lives on the website's shelf page.
        case .addBook: "/reader/library"
        case .discover: "/reader/discover"
        case .settings: "/reader/settings"
        }
    }

    var title: String {
        switch self {
        case .addBook: "Add a book"
        case .discover: "Discover"
        case .settings: "Settings"
        }
    }
}

/// The shelf: Reading, Queue and Archive, books and articles together as on
/// the website, a grid on iPad and a list on iPhone.
struct ShelfScreen: View {
    @State private var store = ShelfStore.shared
    @State private var path: [Route] = []
    @State private var tab: ShelfTab?
    @State private var resumed = false
    @State private var player = AudioPlayer.shared
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        NavigationStack(path: $path) {
            shelf
                .navigationTitle("Reader")
                .toolbar { toolbar }
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .book(let id):
                        ReadingScreen(id: id) { path.removeAll() }
                    case .page(let page):
                        PageScreen(page: page)
                    }
                }
        }
        .safeAreaInset(edge: .bottom) {
            if player.nowPlaying != nil, path.isEmpty { NowPlayingBar(onOpen: open) }
        }
        .task {
            await store.refresh()
            resumeOnce()
        }
        .onChange(of: path) { _, path in
            if path.isEmpty { LastPlace.saved = .shelf(at: .now) }
        }
    }

    private var currentTab: ShelfTab { tab ?? ShelfOrder.firstTab(store.books) }

    @ViewBuilder private var shelf: some View {
        let (main, paused) = ShelfOrder.books(store.books, in: currentTab)
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Picker("Shelf", selection: Binding(get: { currentTab }, set: { tab = $0 })) {
                    ForEach(ShelfTab.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                if store.offline {
                    Label("No connection. Showing your shelf as it was.", systemImage: "wifi.slash")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if main.isEmpty && paused.isEmpty && store.loaded {
                    ContentUnavailableView("Nothing here", systemImage: "books.vertical",
                                           description: Text("Books you add on the website show up here."))
                }
                books(main)
                if !paused.isEmpty {
                    Text("Paused").font(.headline).foregroundStyle(.secondary)
                    books(paused)
                }
            }
            .padding()
        }
        .background(Theme.paper)
        .refreshable {
            await store.refresh()
            await Offline.shared.keepRecentBooks()
        }
        .overlay { if !store.loaded { ProgressView() } }
    }

    @ViewBuilder private func books(_ books: [ShelfBook]) -> some View {
        if sizeClass == .regular {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 200), spacing: 20, alignment: .top)], spacing: 24) {
                ForEach(books) { book in
                    Button { open(book.id) } label: { BookTile(book: book, onDevice: store.onDevice.contains(book.id)) }
                        .buttonStyle(.plain)
                        .disabled(!book.isReady)
                }
            }
        } else {
            LazyVStack(spacing: 0) {
                ForEach(books) { book in
                    Button { open(book.id) } label: { BookRow(book: book, onDevice: store.onDevice.contains(book.id)) }
                        .buttonStyle(.plain)
                        .disabled(!book.isReady)
                    Divider()
                }
            }
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) { AccountMenu(email: Session.shared.email) }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button("Add a book", systemImage: "plus") { path.append(.page(.addBook)) }
                Button("Discover", systemImage: "sparkles") { path.append(.page(.discover)) }
                Button("Settings", systemImage: "gearshape") { path.append(.page(.settings)) }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
        }
    }

    private func open(_ id: UUID) {
        LastPlace.saved = .book(id, at: .now)
        path = [.book(id)]
    }

    /// Back where you left off, once per launch (R3).
    private func resumeOnce() {
        guard !resumed else { return }
        resumed = true
        if let book = ShelfOrder.resume(place: LastPlace.saved, books: store.books) { open(book.id) }
    }
}

/// A book in the iPhone list.
struct BookRow: View {
    let book: ShelfBook
    let onDevice: Bool

    var body: some View {
        HStack(spacing: 14) {
            Cover(book: book).frame(width: 52)
            VStack(alignment: .leading, spacing: 3) {
                Text(book.title)
                    .font(.system(.body, design: .serif).weight(.medium))
                    .lineLimit(2)
                if let byline = BookCaption.byline(book) {
                    Text(byline).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                BookCaption(book: book, onDevice: onDevice)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .opacity(book.isReady ? 1 : 0.6)
    }
}

/// A book in the iPad grid.
struct BookTile: View {
    let book: ShelfBook
    let onDevice: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Cover(book: book)
            Text(book.title)
                .font(.system(.subheadline, design: .serif).weight(.medium))
                .lineLimit(2)
            if let byline = BookCaption.byline(book) {
                Text(byline).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            BookCaption(book: book, onDevice: onDevice)
        }
        .contentShape(Rectangle())
        .opacity(book.isReady ? 1 : 0.6)
    }
}

/// Progress, whether it's on the device, or why it can't open yet.
struct BookCaption: View {
    let book: ShelfBook
    let onDevice: Bool

    static func byline(_ book: ShelfBook) -> String? {
        book.isArticle ? book.site_name ?? book.author : book.author
    }

    var body: some View {
        HStack(spacing: 6) {
            switch book.content {
            case "ready":
                if book.isArticle, let words = book.word_count, words > 0 {
                    Text("\(max(1, words / 200)) min")
                }
                if let progress = book.progress, progress > 0 {
                    Text("\(Int((progress * 100).rounded()))%")
                }
                if onDevice {
                    Label("On this device", systemImage: "arrow.down.circle.fill")
                        .labelStyle(.iconOnly)
                        .foregroundStyle(Theme.accent)
                }
            case "processing", "uploaded":
                Text("Converting…")
            case "failed":
                Text("Conversion failed")
            default:
                Text("No file yet")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }
}

/// The reading screen: the website's reader, full screen. Its own back control
/// returns to the shelf.
struct ReadingScreen: View {
    let id: UUID
    let onShelf: () -> Void

    var body: some View {
        ReadingWebView(path: "/reader/\(id.uuidString.lowercased())/read", onShelf: onShelf)
            .background(Theme.paper)
            .toolbar(.hidden, for: .navigationBar)
            .task { await Offline.shared.keepRecentBooks() }
    }
}

/// A Reader page that stays web.
struct PageScreen: View {
    let page: WebPage

    var body: some View {
        PageWebView(path: page.path)
            .background(Theme.paper)
            .navigationTitle(page.title)
            .navigationBarTitleDisplayMode(.inline)
    }
}
