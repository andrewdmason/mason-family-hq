import AVFoundation
import SwiftUI
import UIKit

/// The live picture, which doubles as the pitch button: the instant a finger
/// lands (not when it lifts) is the pitch, timed with the touch's own clock.
struct CameraPreview: UIViewRepresentable {
    let capture: CaptureController
    let onTouchDown: (TimeInterval) -> Void

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = capture.session
        view.previewLayer.videoGravity = .resizeAspect
        view.onTouchDown = onTouchDown
        view.onLayout = { [capture] in capture.updatePreviewRotation() }
        capture.attachPreview(view.previewLayer)
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        view.onTouchDown = onTouchDown
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        var onTouchDown: ((TimeInterval) -> Void)?
        var onLayout: (() -> Void)?

        override init(frame: CGRect) {
            super.init(frame: frame)
            backgroundColor = .black
            isMultipleTouchEnabled = false
        }

        required init?(coder: NSCoder) { fatalError() }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            if let touch = touches.first { onTouchDown?(touch.timestamp) }
        }

        // Turning the phone between the two landscape ways re-lays it out.
        override func layoutSubviews() {
            super.layoutSubviews()
            onLayout?()
        }
    }
}
