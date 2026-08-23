import AVFoundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
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

  /// A solid-colour PNG, which is what a photograph is to this renderer.
  private func writeStill(level: UInt8, size: CGSize = CGSize(width: 64, height: 48)) throws -> URL {
    let url = directory.appendingPathComponent("still-\(UUID().uuidString).png")
    let width = Int(size.width)
    let height = Int(size.height)
    var pixels = [UInt8](repeating: level, count: width * height * 4)
    for index in stride(from: 3, to: pixels.count, by: 4) { pixels[index] = 255 }
    let context = CGContext(
      data: &pixels,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
    guard let image = context?.makeImage(),
          let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else {
      XCTFail("could not write the still")
      return url
    }
    CGImageDestinationAddImage(destination, image, nil)
    CGImageDestinationFinalize(destination)
    return url
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

  /**
   A photograph, held for the length of its clip.

   `loadTracks(withMediaCharacteristic: .visual)` comes back empty for a PNG, so
   the segment was dropped and the export came out shorter than the cut with
   nothing saying why — which is why mobile export refused a timeline with a
   still in it rather than shipping a wrong video.
   */
  func testHoldsAStillForTheLengthOfItsClip() async throws {
    let still = try writeStill(level: 200)
    let output = try await VideoComposer.export(
      ComposerRequest(
        width: 64,
        height: 48,
        frameRate: 30,
        durationMs: 3_000,
        videoSegments: [ComposerSegment(uri: still.absoluteString, sourceEndMs: 3_000, still: true)]
      )
    )

    let duration = try await AVURLAsset(url: output).load(.duration).seconds
    XCTAssertEqual(duration, 3, accuracy: 0.3, "a still has to be held for its clip, not dropped")

    // And it is the picture, not black: a hold that produced an empty frame
    // would pass a duration check and fail the only one that matters.
    let middle = try await luminance(of: output, atSeconds: 1.5)
    XCTAssertEqual(middle, 200, accuracy: 30, "the frame at the middle of the hold should be the photograph")
  }

  /**
   A still beside a movie, which is what a timeline actually looks like.

   Encoding the still first is what lets everything after it treat the two the
   same — the trim, the retime, the placement and the transitions all run on an
   ordinary source — so the test that matters is that both survive one export.
   */
  func testHoldsAStillNextToAClip() async throws {
    let still = try writeStill(level: 30)
    let clip = try writeRamp(seconds: 2)
    let output = try await VideoComposer.export(
      ComposerRequest(
        width: 64,
        height: 48,
        frameRate: 30,
        durationMs: 4_000,
        videoSegments: [
          ComposerSegment(uri: clip.absoluteString, sourceEndMs: 2_000),
          ComposerSegment(uri: still.absoluteString, timelineStartMs: 2_000, sourceEndMs: 2_000, still: true)
        ]
      )
    )

    let duration = try await AVURLAsset(url: output).load(.duration).seconds
    XCTAssertEqual(duration, 4, accuracy: 0.3, "the cut is the clip and then the hold")
    let onTheStill = try await luminance(of: output, atSeconds: 3)
    XCTAssertEqual(onTheStill, 30, accuracy: 30, "the second half of the cut is the photograph")
  }

  /**
   Colour, which iOS used to read and drop.

   The grade reaches this renderer through the shared plan and had nowhere to go:
   layer instructions carry a transform and an opacity and no colour, so the
   controls were disabled on the phone with the reason on screen. This exports the
   same clip twice and reads the two files back — the only evidence that means
   anything here is a luminance that moved.
   */
  func testBrightensAGradedClip() async throws {
    let source = try writeRamp(seconds: 2)
    func export(_ colour: ComposerColour) async throws -> Double {
      let output = try await VideoComposer.export(
        ComposerRequest(
          width: 64,
          height: 48,
          frameRate: 30,
          durationMs: 2_000,
          videoSegments: [ComposerSegment(uri: source.absoluteString, sourceEndMs: 2_000, colour: colour)]
        )
      )
      return try await luminance(of: output, atSeconds: 1)
    }

    let neutral = try await export(ComposerColour())
    let brighter = try await export(ComposerColour(brightness: 0.3))
    let darker = try await export(ComposerColour(brightness: -0.3))

    XCTAssertGreaterThan(brighter, neutral + 25, "brightness up should reach the file")
    XCTAssertLessThan(darker, neutral - 25, "brightness down should reach the file")
  }

  /**
   That the compositor draws the picture where the layer instructions did.

   A custom compositor takes over placement as well as colour — Core Image's
   origin is at the bottom left and AVFoundation's is at the top, and getting the
   conversion wrong puts the picture off the frame or upside down while every
   duration and every luminance still passes. So this grades one clip by an amount
   that changes nothing visible and asserts the frame is unchanged.
   */
  func testAGradedExportIsFramedLikeAnUngradedOne() async throws {
    let source = try writeRamp(seconds: 2)
    func export(_ colour: ComposerColour) async throws -> Double {
      let output = try await VideoComposer.export(
        ComposerRequest(
          width: 64,
          height: 48,
          frameRate: 30,
          durationMs: 2_000,
          videoSegments: [ComposerSegment(uri: source.absoluteString, sourceEndMs: 2_000, colour: colour)]
        )
      )
      return try await luminance(of: output, atSeconds: 1)
    }

    // Saturation on a grey clip is a grade that changes nothing a luminance can
    // see — so it only proves the compositor ran, and the frame has to match.
    let throughInstructions = try await export(ComposerColour())
    let throughCompositor = try await export(ComposerColour(saturation: 1.4))
    XCTAssertEqual(
      throughCompositor,
      throughInstructions,
      accuracy: 6,
      "a graded export goes through the custom compositor and must frame the picture identically"
    )
  }

  /**
   A dip still dips when the compositor is the one drawing it.

   The ramps are AVFoundation's to apply in the ungraded path and ours in the
   graded one, which is two implementations of one behaviour — the sort of pair
   that agrees until nobody is looking.
   */
  func testDimsAGradedFrameWhereATransitionDips() async throws {
    let source = try writeRamp(seconds: 2)
    let output = try await VideoComposer.export(
      ComposerRequest(
        width: 64,
        height: 48,
        frameRate: 30,
        durationMs: 2_000,
        videoSegments: [
          ComposerSegment(uri: source.absoluteString, sourceEndMs: 2_000, colour: ComposerColour(saturation: 1.2))
        ],
        dips: [ComposerDip(startMs: 1_200, durationMs: 600)]
      )
    )

    let atDip = try await luminance(of: output, atSeconds: 1.5)
    let after = try await luminance(of: output, atSeconds: 1.95)
    XCTAssertLessThan(atDip, after - 40, "the compositor has to apply the ramps the layer instructions used to")
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
