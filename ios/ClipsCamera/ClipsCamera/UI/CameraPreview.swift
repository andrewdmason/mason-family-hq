import AVFoundation
import SwiftUI
import UIKit

/// The live picture. It doesn't log pitches (the Pitch button does, so a stray
/// touch can't); a touch only wakes a camera that dozed off between at-bats.
struct CameraPreview: UIViewRepresentable {
    let capture: CaptureController
    let onTouch: () -> Void

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = capture.session
        view.previewLayer.videoGravity = .resizeAspect
        view.onTouch = onTouch
        view.onLayout = { [capture] in capture.updatePreviewRotation() }
        capture.attachPreview(view.previewLayer)
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        view.onTouch = onTouch
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        var onTouch: (() -> Void)?
        var onLayout: (() -> Void)?

        override init(frame: CGRect) {
            super.init(frame: frame)
            backgroundColor = .black
        }

        required init?(coder: NSCoder) { fatalError() }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            onTouch?()
        }

        // Turning the phone between the two landscape ways re-lays it out.
        override func layoutSubviews() {
            super.layoutSubviews()
            onLayout?()
        }
    }
}
