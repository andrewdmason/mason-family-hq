import AppKit

/// The notes in an open to-do. The rules are in NoteEditing; this is the Mac's side
/// of them: keys, clicks, the clipboard and undo.
final class DetailNotesView: NSTextView, NSTextViewDelegate {
    private(set) var noteStyle = NoteStyle(size: 14, accent: .controlAccentColor, indent: 22)
    var onChange: (String) -> Void = { _ in }
    var onTabOut: () -> Void = {}
    /// Files on the clipboard. True when they've been taken as attachments.
    var onPasteFiles: (NSPasteboard) -> Bool = { _ in false }

    private var applying = false
    private var changedRange = NSRange(location: 0, length: 0)
    private var shownHTML: String?
    private let undoer = UndoManager()
    /// A text system built by hand is owned from its storage down, so this holds it.
    private var ownedStorage: NSTextStorage?

    static func make(style: NoteStyle) -> DetailNotesView {
        let (storage, _, container) = NoteLayoutManager.makeStack(style: style)
        container.widthTracksTextView = true
        let view = DetailNotesView(frame: .zero, textContainer: container)
        view.ownedStorage = storage
        view.noteStyle = style
        view.setUp()
        return view
    }

    private func setUp() {
        delegate = self
        drawsBackground = false
        isRichText = true
        importsGraphics = false
        allowsUndo = true
        textContainerInset = .zero
        insertionPointColor = noteStyle.accent
        isAutomaticLinkDetectionEnabled = false
        isAutomaticDashSubstitutionEnabled = false
        isAutomaticQuoteSubstitutionEnabled = false
        isAutomaticTextReplacementEnabled = false
        linkTextAttributes = [
            .foregroundColor: noteStyle.accent, .underlineStyle: NSUnderlineStyle.single.rawValue, .cursor: NSCursor.pointingHand,
        ]
        typingAttributes = noteStyle.attributes(.paragraph)
    }

    /// Dropped files belong to the row underneath, not in the text as a path.
    override var acceptableDragTypes: [NSPasteboard.PasteboardType] {
        super.acceptableDragTypes.filter { $0 != .fileURL && $0.rawValue != "NSFilenamesPboardType" }
    }

    func show(html: String) {
        guard html != shownHTML, let textStorage else { return }
        let (text, editable) = NoteEditing.display(html, style: noteStyle)
        shownHTML = html
        isEditable = editable
        applying = true
        textStorage.setAttributedString(text)
        applying = false
        setSelectedRange(NSRange(location: text.length, length: 0))
        typingAttributes = NoteEditing.typingAttributes(in: textStorage, at: text.length, style: noteStyle)
        undoer.removeAllActions()
        needsDisplay = true
    }

    /// Includes the blank line after a final newline, where the cursor can be.
    var usedTextHeight: CGFloat {
        guard let layoutManager, let textContainer else { return 0 }
        layoutManager.ensureLayout(for: textContainer)
        return ceil(layoutManager.usedRect(for: textContainer).height)
    }

    private func report() {
        guard let textStorage else { return }
        let html = NotesHTML.serialize(NoteEditing.document(from: textStorage))
        shownHTML = html
        onChange(html)
    }

    func apply(_ edit: NoteEditing.Edit) {
        guard let textStorage else { return }
        applying = true
        defer { applying = false }
        guard shouldChangeText(in: edit.range, replacementString: edit.replacement.string) else { return }
        changedRange = NSRange(location: edit.range.location, length: edit.replacement.length)
        textStorage.replaceCharacters(in: edit.range, with: edit.replacement)
        setSelectedRange(edit.selection)
        didChangeText()
        let kind = NoteEditing.paragraph(at: edit.selection.location, in: textStorage).kind
        typingAttributes = edit.clearsTypingMarks
            ? noteStyle.attributes(kind)
            : NoteEditing.typingAttributes(in: textStorage, at: edit.selection.location, style: noteStyle)
    }

    // MARK: Delegate

    func textView(_ textView: NSTextView, shouldChangeTextInRanges affectedRanges: [NSValue], replacementStrings: [String]?) -> Bool {
        guard !applying, let textStorage, let range = affectedRanges.first?.rangeValue else { return true }
        let inserted = replacementStrings?.first ?? ""
        changedRange = NSRange(location: range.location, length: (inserted as NSString).length)
        guard affectedRanges.count == 1, !hasMarkedText(), undoer.isUndoing == false, undoer.isRedoing == false,
            let edit = NoteEditing.typing(inserted, at: range, in: textStorage, style: noteStyle)
        else { return true }
        apply(edit)
        return false
    }

    func textDidChange(_ notification: Notification) {
        guard let textStorage else { return }
        if !hasMarkedText() {
            NoteEditing.normalize(textStorage, around: changedRange, caret: selectedRange().location, style: noteStyle)
        }
        needsDisplay = true
        report()
    }

    func textView(_ textView: NSTextView, willChangeSelectionFromCharacterRange old: NSRange, toCharacterRange new: NSRange) -> NSRange {
        guard let textStorage else { return new }
        return NoteEditing.adjustedSelection(old: old, proposed: new, in: textStorage)
    }

    func textViewDidChangeSelection(_ notification: Notification) {
        guard !applying, !hasMarkedText(), let textStorage, selectedRange().length == 0 else { return }
        typingAttributes = NoteEditing.typingAttributes(in: textStorage, at: selectedRange().location, style: noteStyle)
    }

    func undoManager(for view: NSTextView) -> UndoManager? { undoer }

    /// Tab indents a list item. Elsewhere it goes between the name and the notes.
    func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
        guard let textStorage else { return false }
        switch selector {
        case #selector(NSResponder.insertTab(_:)):
            if isEditable, let edit = NoteEditing.indent(selectedRange(), in: textStorage, style: noteStyle) {
                apply(edit)
            } else {
                onTabOut()
            }
            return true
        case #selector(NSResponder.insertBacktab(_:)):
            if isEditable, let edit = NoteEditing.outdent(selectedRange(), in: textStorage, style: noteStyle) {
                apply(edit)
            } else {
                onTabOut()
            }
            return true
        case #selector(NSResponder.moveUp(_:)):
            guard isCaretOnFirstLine else { return false }
            onTabOut()
            return true
        default:
            return false
        }
    }

    /// Up from here leaves the notes for the to-do's name.
    var isCaretOnFirstLine: Bool {
        guard let textStorage, let layoutManager, textStorage.length > 0 else { return true }
        let caret = selectedRange().location
        if caret >= textStorage.length, textStorage.string.hasSuffix("\n") { return false }
        let glyph = layoutManager.glyphIndexForCharacter(at: min(caret, textStorage.length - 1))
        return layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil).minY
            == layoutManager.lineFragmentRect(forGlyphAt: 0, effectiveRange: nil).minY
    }

    func moveCaretToStart() {
        guard let textStorage else { return }
        setSelectedRange(NSRange(location: NoteEditing.paragraph(at: 0, in: textStorage).textStart, length: 0))
    }

    // MARK: Keys

    /// The website's shortcuts, less ⌘E, which moves a to-do to This Week here.
    func handleShortcut(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting([.capsLock, .numericPad, .function])
        guard flags.contains(.command), let textStorage else { return false }
        let plain = flags == [.command]
        let shifted = flags == [.command, .shift]
        let optioned = flags == [.command, .option]
        let key = event.charactersIgnoringModifiers?.lowercased() ?? ""

        if key == "z", plain || shifted {
            if shifted { undoer.redo() } else { undoer.undo() }
            return true
        }
        guard isEditable else { return false }
        if plain, key == "b" { toggle(.bold); return true }
        if plain, key == "i" { toggle(.italic); return true }
        if plain, key == "u" { toggle(.underline); return true }
        if shifted, key == "s" { toggle(.strike); return true }

        var block: NoteLineKind?
        if optioned {
            switch event.keyCode {
            case 18: block = .heading(1)
            case 19: block = .heading(2)
            case 20: block = .heading(3)
            case 8: block = .code
            default: break
            }
        } else if shifted {
            switch event.keyCode {
            case 26: block = .list(path: [.ordered], checked: false)
            case 28: block = .list(path: [.bullet], checked: false)
            case 25: block = .list(path: [.task], checked: false)
            case 11: block = .quote
            default: break
            }
        }
        guard let block else { return false }
        apply(NoteEditing.setBlock(block, selection: selectedRange(), in: textStorage, style: noteStyle))
        return true
    }

    private func toggle(_ mark: NoteMarks) {
        guard let textStorage else { return }
        let selection = selectedRange()
        if let edit = NoteEditing.toggle(mark, selection: selection, in: textStorage, style: noteStyle) {
            apply(edit)
            return
        }
        // No selection: applies to what's typed next.
        var marks = NoteMarks(rawValue: typingAttributes[.noteMarks] as? Int ?? 0)
        if marks.contains(mark) { marks.remove(mark) } else { marks.insert(mark) }
        let kind = NoteEditing.paragraph(at: selection.location, in: textStorage).kind
        typingAttributes = noteStyle.attributes(kind, marks: marks)
    }

    // MARK: Mouse and clipboard

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if isEditable, let textStorage, let manager = layoutManager as? NoteLayoutManager,
            let line = manager.checkboxLine(at: point),
            let edit = NoteEditing.toggleChecked(at: line, selection: selectedRange(), in: textStorage, style: noteStyle) {
            apply(edit)
            return
        }
        super.mouseDown(with: event)
    }

    override func paste(_ sender: Any?) {
        let board = NSPasteboard.general
        if onPasteFiles(board) { return }
        guard isEditable, let textStorage, let text = board.string(forType: .string) else { return }
        let selection = selectedRange()
        apply(NoteEditing.paste(text, selection: selection, in: textStorage, style: noteStyle))
        if selection.length == 0, let address = NoteEditing.pastedURL(text) { swapInTitle(of: address) }
    }

    private func swapInTitle(of address: String) {
        Task { @MainActor [weak self] in
            guard let title = await LinkTitle.fetch(address), title != address, let self, let textStorage = self.textStorage,
                let edit = NoteEditing.titleSwap(address: address, title: title, in: textStorage, selection: self.selectedRange(), style: self.noteStyle)
            else { return }
            self.apply(edit)
        }
    }
}
