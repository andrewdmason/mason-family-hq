import AppKit
import Quartz

/// Files on the clipboard or in a drag, read the same way for both.
enum AttachmentPasteboard {
    /// Finder files first, then a copied picture such as a screenshot.
    @MainActor
    static func attach(from board: NSPasteboard, to taskId: String, in store: AttachmentStore) -> Bool {
        let files = fileURLs(on: board)
        if !files.isEmpty {
            store.add(files: files, to: taskId)
            return true
        }
        // Text copied from a document can carry a picture of itself too: text wins.
        guard board.string(forType: .string) == nil else { return false }
        if let png = board.data(forType: .png) {
            store.add(data: png, fileName: "Pasted Image.png", mimeType: "image/png", to: taskId)
            return true
        }
        if let tiff = board.data(forType: .tiff), let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
            store.add(data: png, fileName: "Pasted Image.png", mimeType: "image/png", to: taskId)
            return true
        }
        return false
    }

    static func fileURLs(on board: NSPasteboard) -> [URL] {
        (board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
    }

    @MainActor
    static func choose(for taskId: String, in store: AttachmentStore, window: NSWindow?) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.prompt = "Attach"
        let finish: (NSApplication.ModalResponse) -> Void = { response in
            if response == .OK { store.add(files: panel.urls, to: taskId) }
        }
        if let window {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            panel.begin(completionHandler: finish)
        }
    }
}

/// Quick Look, the same preview as pressing Space in Finder.
final class AttachmentPreview: NSObject, QLPreviewPanelDataSource {
    static let shared = AttachmentPreview()
    private(set) var file: URL?

    func show(_ url: URL) {
        file = url
        guard let panel = QLPreviewPanel.shared() else { return }
        panel.updateController()
        // Whatever has the keyboard, a text field say, may have taken the panel.
        panel.dataSource = self
        panel.reloadData()
        panel.makeKeyAndOrderFront(nil)
    }

    func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int { file == nil ? 0 : 1 }

    func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
        file.map { $0 as NSURL }
    }
}

/// An image thumbnail or a named chip, with an X while the pointer's over it.
final class AttachmentTile: NSView {
    static let imageSide: CGFloat = 80
    static let chipHeight: CGFloat = 26
    static let chipFont = NSFont.systemFont(ofSize: 12)

    private let item: AttachmentItem
    private let store: AttachmentStore
    private let remove = NSButton()
    private let spinner = NSProgressIndicator()
    private var image: NSImage?
    private var tracking: NSTrackingArea?

    override var isFlipped: Bool { true }

    init(item: AttachmentItem, store: AttachmentStore) {
        self.item = item
        self.store = store
        super.init(frame: .zero)
        toolTip = item.failure.map { "\(item.name): \($0)" } ?? item.name

        remove.isBordered = false
        remove.image = NSImage(systemSymbolName: "xmark.circle.fill", accessibilityDescription: "Remove attachment")
        remove.symbolConfiguration = .init(pointSize: 15, weight: .regular)
        remove.contentTintColor = .secondaryLabelColor
        remove.imagePosition = .imageOnly
        remove.target = self
        remove.action = #selector(removeClicked)
        remove.isHidden = true
        addSubview(remove)

        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        addSubview(spinner)
        if item.isUploading { spinner.startAnimation(nil) }

        if item.isImage { loadThumbnail() }
        let menu = NSMenu()
        if item.canRetry { menu.addItem(ClosureMenuItem(title: "Try Again") { [weak self] in self?.retry() }) }
        menu.addItem(ClosureMenuItem(title: "Open") { [weak self] in self?.open() })
        menu.addItem(ClosureMenuItem(title: "Remove") { [weak self] in self?.removeClicked() })
        self.menu = menu
    }

    required init?(coder: NSCoder) { fatalError() }

    private func loadThumbnail() {
        Task { @MainActor [weak self] in
            guard let self, let file = await self.store.previewFile(self.item),
                let thumbnail = AttachmentImaging.thumbnail(of: file, maxEdge: Int(AttachmentTile.imageSide * 2))
            else { return }
            self.image = NSImage(cgImage: thumbnail, size: .zero)
            self.needsDisplay = true
        }
    }

    override func layout() {
        super.layout()
        remove.frame = NSRect(x: bounds.width - 21, y: item.isImage ? 3 : (bounds.height - 18) / 2, width: 18, height: 18)
        let side: CGFloat = 16
        spinner.frame = item.isImage
            ? NSRect(x: (bounds.width - side) / 2, y: (bounds.height - side) / 2, width: side, height: side)
            : NSRect(x: 8, y: (bounds.height - side) / 2, width: side, height: side)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseEntered(with event: NSEvent) { remove.isHidden = false }
    override func mouseExited(with event: NSEvent) { remove.isHidden = true }
    override func mouseUp(with event: NSEvent) {
        guard bounds.contains(convert(event.locationInWindow, from: nil)) else { return }
        if item.canRetry { retry() } else { open() }
    }
    override func mouseDown(with event: NSEvent) {}

    @objc private func removeClicked() { store.remove(item) }
    private func retry() { store.retry(item) }

    private func open() {
        Task { @MainActor [weak self] in
            guard let self, let file = await self.store.originalFile(self.item) else {
                NSSound.beep()
                return
            }
            AttachmentPreview.shared.show(file)
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        let radius: CGFloat = item.isImage ? 8 : bounds.height / 2
        let shape = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: radius, yRadius: radius)
        if item.isImage {
            NSGraphicsContext.saveGraphicsState()
            shape.addClip()
            NSColor.quaternaryLabelColor.setFill()
            bounds.fill()
            if let image, image.size.width > 0, image.size.height > 0 {
                let scale = max(bounds.width / image.size.width, bounds.height / image.size.height)
                let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
                let rect = NSRect(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2, width: size.width, height: size.height)
                image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: item.isUploading ? 0.5 : 1, respectFlipped: true, hints: nil)
            }
            NSGraphicsContext.restoreGraphicsState()
            if item.failure != nil { drawFailureBadge() }
        } else {
            NSColor.controlBackgroundColor.setFill()
            shape.fill()
            drawChipContents()
        }
        (item.failure == nil ? NSColor.separatorColor : NSColor.systemRed).setStroke()
        shape.stroke()
    }

    private func drawFailureBadge() {
        let symbol = NSImage(systemSymbolName: "exclamationmark.circle.fill", accessibilityDescription: "Couldn't upload")?
            .withSymbolConfiguration(.init(paletteColors: [.white, .systemRed]))
        symbol?.draw(in: NSRect(x: (bounds.width - 22) / 2, y: (bounds.height - 22) / 2, width: 22, height: 22), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    }

    private func drawChipContents() {
        let failed = item.failure != nil
        if !item.isUploading {
            let symbol = NSImage(systemSymbolName: failed ? "exclamationmark.circle" : "doc.text", accessibilityDescription: nil)?
                .withSymbolConfiguration(.init(paletteColors: [failed ? .systemRed : .secondaryLabelColor]))
            symbol?.draw(in: NSRect(x: 9, y: (bounds.height - 14) / 2, width: 14, height: 14), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
        }
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingMiddle
        let attributes: [NSAttributedString.Key: Any] = [
            .font: AttachmentTile.chipFont, .paragraphStyle: paragraph,
            .foregroundColor: item.isUploading ? NSColor.secondaryLabelColor : NSColor.labelColor,
        ]
        let text = item.name as NSString
        let height = text.size(withAttributes: attributes).height
        text.draw(in: NSRect(x: 29, y: (bounds.height - height) / 2, width: bounds.width - 39, height: height), withAttributes: attributes)
    }

    static func chipWidth(_ name: String, limit: CGFloat) -> CGFloat {
        min(ceil((name as NSString).size(withAttributes: [.font: chipFont]).width) + 41, min(224, limit))
    }
}

/// A to-do's attachments: thumbnails, wrapping, with file chips under them.
final class AttachmentStripView: NSView {
    private static let gap: CGFloat = 8
    private var shown: [AttachmentItem] = []
    private var tiles: [AttachmentTile] = []

    override var isFlipped: Bool { true }

    /// Where each item goes, and how tall that makes the strip.
    static func arrange(_ items: [AttachmentItem], width: CGFloat) -> (frames: [String: NSRect], height: CGFloat) {
        guard !items.isEmpty else { return ([:], 0) }
        var frames: [String: NSRect] = [:]
        var x: CGFloat = 0
        var y: CGFloat = 0
        for item in items where item.isImage {
            let side = AttachmentTile.imageSide
            if x > 0, x + side > width {
                x = 0
                y += side + gap
            }
            frames[item.id] = NSRect(x: x, y: y, width: side, height: side)
            x += side + gap
        }
        if x > 0 { y += AttachmentTile.imageSide + gap }
        x = 0
        var chipsEnd = y
        for item in items where !item.isImage {
            let chip = AttachmentTile.chipWidth(item.name, limit: width)
            if x > 0, x + chip > width {
                x = 0
                y += AttachmentTile.chipHeight + gap
            }
            frames[item.id] = NSRect(x: x, y: y, width: chip, height: AttachmentTile.chipHeight)
            x += chip + gap
            chipsEnd = y + AttachmentTile.chipHeight + gap
        }
        return (frames, max(chipsEnd - gap, 0))
    }

    func show(_ items: [AttachmentItem], store: AttachmentStore) {
        guard items != shown else { return }
        shown = items
        tiles.forEach { $0.removeFromSuperview() }
        tiles = items.map { AttachmentTile(item: $0, store: store) }
        tiles.forEach(addSubview)
        needsLayout = true
    }

    override func layout() {
        super.layout()
        let frames = Self.arrange(shown, width: bounds.width).frames
        for (item, tile) in zip(shown, tiles) { tile.frame = frames[item.id] ?? .zero }
    }
}

extension AppDelegate {
    override func acceptsPreviewPanelControl(_ panel: QLPreviewPanel!) -> Bool { true }

    override func beginPreviewPanelControl(_ panel: QLPreviewPanel!) {
        panel.dataSource = AttachmentPreview.shared
    }

    override func endPreviewPanelControl(_ panel: QLPreviewPanel!) {
        panel.dataSource = nil
    }
}
