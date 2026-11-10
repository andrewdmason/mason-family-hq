import SwiftUI
import UIKit

/// The notes in a to-do on the phone. The rules are in NoteEditing, shared with the
/// Mac; this is the phone's side of them: taps, the clipboard and the keyboard bar.
final class NoteTextView: UITextView, UITextViewDelegate, UIGestureRecognizerDelegate {
    private(set) var noteStyle: NoteStyle
    var onChange: (String) -> Void = { _ in }
    var onAttach: () -> Void = {}
    var onPasteImage: (UIImage) -> Void = { _ in }

    private var applying = false
    private var changedRange = NSRange(location: 0, length: 0)
    private var previousSelection = NSRange(location: 0, length: 0)
    private var shownHTML: String?
    /// A text system built by hand is owned from its storage down, so this holds it.
    private let ownedStorage: NSTextStorage

    init(style: NoteStyle) {
        noteStyle = style
        let (storage, _, container) = NoteLayoutManager.makeStack(style: style)
        ownedStorage = storage
        container.widthTracksTextView = true
        super.init(frame: .zero, textContainer: container)
        delegate = self
        backgroundColor = .clear
        textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        smartDashesType = .no
        smartQuotesType = .no
        tintColor = style.accent
        linkTextAttributes = [.foregroundColor: style.accent, .underlineStyle: NSUnderlineStyle.single.rawValue]
        typingAttributes = style.attributes(.paragraph)
        inputAccessoryView = makeBar()
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.delegate = self
        addGestureRecognizer(tap)
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(html: String) {
        guard html != shownHTML else { return }
        let (text, editable) = NoteEditing.display(html, style: noteStyle)
        shownHTML = html
        isEditable = editable
        applying = true
        textStorage.setAttributedString(text)
        applying = false
        selectedRange = NSRange(location: text.length, length: 0)
        previousSelection = selectedRange
        typingAttributes = NoteEditing.typingAttributes(in: textStorage, at: text.length, style: noteStyle)
        setNeedsDisplay()
    }

    private func report() {
        let html = NotesHTML.serialize(NoteEditing.document(from: textStorage))
        shownHTML = html
        onChange(html)
    }

    /// The system's undo can't follow text changed underneath it, so a structural
    /// edit starts undo over rather than risk it replaying the wrong range.
    func apply(_ edit: NoteEditing.Edit) {
        applying = true
        textStorage.replaceCharacters(in: edit.range, with: edit.replacement)
        NoteEditing.normalize(
            textStorage, around: NSRange(location: edit.range.location, length: edit.replacement.length),
            caret: edit.selection.location, style: noteStyle)
        selectedRange = edit.selection
        previousSelection = edit.selection
        applying = false
        undoManager?.removeAllActions()
        let kind = NoteEditing.paragraph(at: edit.selection.location, in: textStorage).kind
        typingAttributes = edit.clearsTypingMarks
            ? noteStyle.attributes(kind)
            : NoteEditing.typingAttributes(in: textStorage, at: edit.selection.location, style: noteStyle)
        layoutManager.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: textStorage.length))
        report()
    }

    // MARK: Delegate

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        guard !applying else { return true }
        changedRange = NSRange(location: range.location, length: (text as NSString).length)
        guard markedTextRange == nil, undoManager?.isUndoing != true, undoManager?.isRedoing != true,
            let edit = NoteEditing.typing(text, at: range, in: textStorage, style: noteStyle)
        else { return true }
        apply(edit)
        return false
    }

    func textViewDidChange(_ textView: UITextView) {
        if markedTextRange == nil {
            NoteEditing.normalize(textStorage, around: changedRange, caret: selectedRange.location, style: noteStyle)
        }
        layoutManager.invalidateDisplay(forCharacterRange: NSRange(location: 0, length: textStorage.length))
        report()
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
        guard !applying, markedTextRange == nil else { return }
        let adjusted = NoteEditing.adjustedSelection(old: previousSelection, proposed: selectedRange, in: textStorage)
        if adjusted != selectedRange {
            applying = true
            selectedRange = adjusted
            applying = false
        }
        previousSelection = adjusted
        if adjusted.length == 0 {
            typingAttributes = NoteEditing.typingAttributes(in: textStorage, at: adjusted.location, style: noteStyle)
        }
    }

    // MARK: Taps

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    @objc private func tapped(_ gesture: UITapGestureRecognizer) {
        var point = gesture.location(in: self)
        point.x -= textContainerInset.left
        point.y -= textContainerInset.top
        guard let manager = layoutManager as? NoteLayoutManager else { return }
        if isEditable, let line = manager.checkboxLine(at: point),
            let edit = NoteEditing.toggleChecked(at: line, selection: selectedRange, in: textStorage, style: noteStyle) {
            apply(edit)
            return
        }
        guard textStorage.length > 0 else { return }
        var fraction: CGFloat = 0
        let index = manager.characterIndex(for: point, in: textContainer, fractionOfDistanceBetweenInsertionPoints: &fraction)
        guard index < textStorage.length, manager.lineFragmentRect(forGlyphAt: manager.glyphIndexForCharacter(at: index), effectiveRange: nil).contains(point),
            let link = NoteEditing.linkString(textStorage.attribute(.link, at: index, effectiveRange: nil)), let url = URL(string: link)
        else { return }
        UIApplication.shared.open(url)
    }

    // MARK: Clipboard

    override func paste(_ sender: Any?) {
        let board = UIPasteboard.general
        if !board.hasStrings, let image = board.image {
            onPasteImage(image)
            return
        }
        guard isEditable, let text = board.string else { return }
        let selection = selectedRange
        apply(NoteEditing.paste(text, selection: selection, in: textStorage, style: noteStyle))
        guard selection.length == 0, let address = NoteEditing.pastedURL(text) else { return }
        Task { @MainActor [weak self] in
            guard let title = await LinkTitle.fetch(address), title != address, let self,
                let edit = NoteEditing.titleSwap(address: address, title: title, in: self.textStorage, selection: self.selectedRange, style: self.noteStyle)
            else { return }
            self.apply(edit)
        }
    }

    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(paste(_:)) { return UIPasteboard.general.hasStrings || UIPasteboard.general.hasImages }
        return super.canPerformAction(action, withSender: sender)
    }

    // MARK: The bar above the keyboard

    private func makeBar() -> UIView {
        let bar = UIToolbar(frame: CGRect(x: 0, y: 0, width: 320, height: 44))
        func item(_ symbol: String, _ label: String, _ action: @escaping () -> Void) -> UIBarButtonItem {
            let button = UIBarButtonItem(image: UIImage(systemName: symbol), primaryAction: UIAction { _ in action() })
            button.accessibilityLabel = label
            return button
        }
        func gap() -> UIBarButtonItem { .flexibleSpace() }
        bar.items = [
            item("bold", "Bold") { [weak self] in self?.toggle(.bold) }, gap(),
            item("italic", "Italic") { [weak self] in self?.toggle(.italic) }, gap(),
            item("textformat.size", "Heading") { [weak self] in self?.setBlock(.heading(2)) }, gap(),
            item("list.bullet", "Bullet list") { [weak self] in self?.setBlock(.list(path: [.bullet], checked: false)) }, gap(),
            item("checklist", "Checklist") { [weak self] in self?.setBlock(.list(path: [.task], checked: false)) }, gap(),
            item("paperclip", "Attach") { [weak self] in self?.onAttach() },
        ]
        return bar
    }

    private func setBlock(_ kind: NoteLineKind) {
        guard isEditable else { return }
        apply(NoteEditing.setBlock(kind, selection: selectedRange, in: textStorage, style: noteStyle))
    }

    private func toggle(_ mark: NoteMarks) {
        guard isEditable else { return }
        if let edit = NoteEditing.toggle(mark, selection: selectedRange, in: textStorage, style: noteStyle) {
            apply(edit)
            return
        }
        var marks = NoteMarks(rawValue: typingAttributes[.noteMarks] as? Int ?? 0)
        if marks.contains(mark) { marks.remove(mark) } else { marks.insert(mark) }
        let kind = NoteEditing.paragraph(at: selectedRange.location, in: textStorage).kind
        typingAttributes = noteStyle.attributes(kind, marks: marks)
    }
}

struct RichNotesEditor: UIViewRepresentable {
    @Binding var html: String
    var onAttach: () -> Void
    var onPasteImage: (UIImage) -> Void

    private static let style = NoteStyle(size: 17, accent: UIColor(PhoneLook.accent), indent: 26)

    func makeUIView(context: Context) -> NoteTextView {
        let view = NoteTextView(style: Self.style)
        view.show(html: html)
        return view
    }

    func updateUIView(_ view: NoteTextView, context: Context) {
        view.onChange = { html = $0 }
        view.onAttach = onAttach
        view.onPasteImage = onPasteImage
        view.show(html: html)
    }
}
