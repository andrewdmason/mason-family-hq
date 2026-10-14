import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import Vision

// A kid's headshot for the title card: the person lifted out of the photo
// (Vision's subject lift, on the phone), a thick white outline round them like
// a sticker, trimmed to fit and sized down.

enum Headshot {
    struct NoPerson: LocalizedError {
        var errorDescription: String? { "Couldn't find a person in that photo. Try one where they stand out from the background." }
    }

    /// The cut-out headshot, as a transparent PNG-ready image.
    static func cutout(_ photo: UIImage) async throws -> UIImage {
        try await Task.detached(priority: .userInitiated) { try make(photo) }.value
    }

    private static func make(_ photo: UIImage) throws -> UIImage {
        guard let upright = upright(photo, maxSide: 2000), let cg = upright.cgImage else { throw NoPerson() }
        let handler = VNImageRequestHandler(cgImage: cg)
        let request = VNGenerateForegroundInstanceMaskRequest()
        try handler.perform([request])
        guard let result = request.results?.first, !result.allInstances.isEmpty else { throw NoPerson() }
        // The biggest subject: the kid, not a sliver of someone at the edge.
        let context = CIContext()
        var best: (instance: Int, area: CGFloat) = (0, -1)
        for instance in result.allInstances {
            guard let mask = try? result.generateScaledMaskForImage(forInstances: [instance], from: handler) else { continue }
            let average = CIFilter.areaAverage()
            average.inputImage = CIImage(cvPixelBuffer: mask)
            average.extent = average.inputImage!.extent
            var px = [Float](repeating: 0, count: 4)
            context.render(average.outputImage!, toBitmap: &px, rowBytes: 16, bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
                           format: .RGBAf, colorSpace: nil)
            if CGFloat(px[0]) > best.area { best = (instance, CGFloat(px[0])) }
        }
        let maskBuffer = try result.generateScaledMaskForImage(forInstances: [best.instance], from: handler)
        let source = CIImage(cgImage: cg)
        let mask = CIImage(cvPixelBuffer: maskBuffer)
        // The outline: the mask grown by about 2% of the photo's height, in white, under the person.
        let stroke = max(6, source.extent.height * 0.019)
        let grown = mask.clampedToExtent().applyingFilter("CIMorphologyMaximum", parameters: [kCIInputRadiusKey: stroke]).cropped(to: source.extent)
        let white = CIImage(color: .white).cropped(to: source.extent)
        let outline = white.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: grown])
        let person = source.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: CIImage.empty(), kCIInputMaskImageKey: mask])
        let sticker = person.composited(over: outline)
        guard let full = context.createCGImage(sticker, from: source.extent, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)),
              let trimmed = trim(full) else { throw NoPerson() }
        return UIImage(cgImage: trimmed)
    }

    /// The photo the right way up, no bigger than `maxSide`.
    private static func upright(_ photo: UIImage, maxSide: CGFloat) -> UIImage? {
        let scale = min(1, maxSide / max(photo.size.width, photo.size.height))
        let size = CGSize(width: (photo.size.width * scale).rounded(), height: (photo.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in photo.draw(in: CGRect(origin: .zero, size: size)) }
    }

    /// Cropped to what isn't transparent.
    private static func trim(_ image: CGImage) -> CGImage? {
        let w = image.width, h = image.height
        var data = [UInt8](repeating: 0, count: w * h * 4)
        guard let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        var minX = w, minY = h, maxX = -1, maxY = -1
        for y in 0 ..< h {
            let row = y * w * 4
            for x in 0 ..< w where data[row + x * 4 + 3] > 8 {
                if x < minX { minX = x }
                if x > maxX { maxX = x }
                if y < minY { minY = y }
                if y > maxY { maxY = y }
            }
        }
        guard maxX >= minX, maxY >= minY else { return nil }
        // The bitmap's rows run top-down, as the image's do.
        return image.cropping(to: CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1))
    }
}
