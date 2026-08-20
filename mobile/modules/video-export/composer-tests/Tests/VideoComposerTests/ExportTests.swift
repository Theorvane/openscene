import AVFoundation
import CoreImage
import XCTest

@testable import VideoComposer

/**
 The iOS renderer, run rather than compiled.

 Everything this repository asserted about iOS was a source assertion — that the
 code contains `setOpacityRamp(`, that it contains `CATextLayer`. That is
 evidence a line exists. Every rendering bug found this month was found by
 exporting a file and measuring it, and iOS was the one renderer nothing could
 export from, because its composition logic was locked inside an Expo module.

 These tests write a source clip, run it through the same code the phone runs,
 and read the result back out of the file.
 */
final class ExportTests: XCTestCase {
  private var directory: URL!

  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: directory)
  }

  /**
   A clip whose brightness climbs steadily, so a frame's own value says which
   moment it came from.

   That is what makes a retime measurable: at 2×, the frame two seconds in has
   to be the one the source shows at four.
   */
  private func writeRamp(seconds: Double, size: CGSize = CGSize(width: 64, height: 48)) throws -> URL {
    let url = directory.appendingPathComponent("ramp-\(UUID().uuidString).mp4")
    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: Int(size.width),
        AVVideoHeightKey: Int(size.height)
      ]
    )
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    )
    writer.add(input)
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)

    let frames = Int(seconds * 30)
    for frame in 0..<frames {
      var buffer: CVPixelBuffer?
      CVPixelBufferCreate(nil, Int(size.width), Int(size.height), kCVPixelFormatType_32BGRA, nil, &buffer)
      guard let pixels = buffer else { continue }
      CVPixelBufferLockBaseAddress(pixels, [])
      // Grey, climbing from black to white across the clip.
      let level = UInt8(Double(frame) / Double(max(1, frames - 1)) * 255)
      if let base = CVPixelBufferGetBaseAddress(pixels) {
        memset(base, Int32(level), CVPixelBufferGetBytesPerRow(pixels) * Int(size.height))
      }
      CVPixelBufferUnlockBaseAddress(pixels, [])
      while !input.isReadyForMoreMediaData { usleep(1000) }
      adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 30))
    }
    input.markAsFinished()
    let finished = expectation(description: "written")
    writer.finishWriting { finished.fulfill() }
    wait(for: [finished], timeout: 30)
    XCTAssertEqual(writer.status, .completed, "could not write the source clip: \(String(describing: writer.error))")
    return url
  }

  /// Mean luminance of the exported frame at a moment, read back out of the file.
  private func luminance(of url: URL, atSeconds seconds: Double) async throws -> Double {
    let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 60)
    generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 60)
    let image = try generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600), actualTime: nil)

    let width = image.width
    let height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let context = CGContext(
      data: &pixels,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
    context?.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

    var total = 0.0
    for index in stride(from: 0, to: pixels.count, by: 4) {
      total += 0.299 * Double(pixels[index]) + 0.587 * Double(pixels[index + 1]) + 0.114 * Double(pixels[index + 2])
    }
    return total / Double(width * height)
  }

  func testExportsAClipOfTheLengthTheTimelineAsksFor() async throws {
    let source = try writeRamp(seconds: 2)
    let request = ComposerRequest(
      width: 64,
      height: 48,
      frameRate: 30,
      durationMs: 2_000,
      videoSegments: [ComposerSegment(uri: source.absoluteString, sourceEndMs: 2_000)]
    )

    let output = try await VideoComposer.export(request)
    let duration = try await AVURLAsset(url: output).load(.duration).seconds
    XCTAssertEqual(duration, 2, accuracy: 0.2)
  }

  func testRetimesTheClipRatherThanTruncatingIt() async throws {
    // Four seconds of ramp at 2× is two seconds of cut, and the frame one second
    // in must be the one the source shows at two.
    let source = try writeRamp(seconds: 4)
    let request = ComposerRequest(
      width: 64,
      height: 48,
      frameRate: 30,
      durationMs: 2_000,
      videoSegments: [ComposerSegment(uri: source.absoluteString, sourceEndMs: 4_000, speed: 2)]
    )

    let output = try await VideoComposer.export(request)
    let duration = try await AVURLAsset(url: output).load(.duration).seconds
    XCTAssertEqual(duration, 2, accuracy: 0.3, "a retimed clip should be half as long, not truncated")

    // Half way through the export is half way through the source: mid grey.
    let middle = try await luminance(of: output, atSeconds: 1)
    XCTAssertEqual(middle, 128, accuracy: 45, "the frame at 1s should be the source's frame at 2s")
  }

  func testDimsTheFrameWhereATransitionDips() async throws {
    let source = try writeRamp(seconds: 2)
    let request = ComposerRequest(
      width: 64,
      height: 48,
      frameRate: 30,
      durationMs: 2_000,
      videoSegments: [ComposerSegment(uri: source.absoluteString, sourceEndMs: 2_000)],
      dips: [ComposerDip(startMs: 1_200, durationMs: 600)]
    )

    let output = try await VideoComposer.export(request)
    // The ramp is brightest at its end, so a dip centred at 1.5s has to fight
    // the brightest part of the clip — which is the point.
    let atDip = try await luminance(of: output, atSeconds: 1.5)
    let after = try await luminance(of: output, atSeconds: 1.95)
    XCTAssertLessThan(atDip, after - 40, "the frame at the midpoint of a dip should be far darker than the one after it")
  }

  func testRefusesACompositionWithNothingInIt() async throws {
    do {
      _ = try await VideoComposer.export(ComposerRequest(durationMs: 1_000))
      XCTFail("an empty composition should be refused rather than exported")
    } catch ComposerError.emptyComposition {
      // The expected refusal.
    }
  }
}
