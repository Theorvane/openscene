import AVFoundation
import XCTest

@testable import VideoComposer

/**
 The measurement an export is checked against.

 A check nobody verified is worse than none: it would report every export as
 matching whatever the file contained, and the whole point of it is to notice
 when a file does not. So these write files whose size, length and sound are
 known, and check the reading follows them.
 */
final class FactsTests: XCTestCase {
  private var directory: URL!

  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: directory)
  }

  /// A plain grey clip of a known size and length.
  private func writeClip(seconds: Double, size: CGSize, rotated: Bool = false) throws -> URL {
    let url = directory.appendingPathComponent("clip-\(UUID().uuidString).mp4")
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
    // A quarter turn, the way a phone stores an upright recording: landscape
    // pixels with a transform on them.
    if rotated { input.transform = CGAffineTransform(rotationAngle: .pi / 2) }
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
      if let base = CVPixelBufferGetBaseAddress(pixels) {
        memset(base, 128, CVPixelBufferGetBytesPerRow(pixels) * Int(size.height))
      }
      CVPixelBufferUnlockBaseAddress(pixels, [])
      while !input.isReadyForMoreMediaData { usleep(1000) }
      adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 30))
    }
    input.markAsFinished()
    let finished = expectation(description: "written")
    writer.finishWriting { finished.fulfill() }
    wait(for: [finished], timeout: 30)
    XCTAssertEqual(writer.status, .completed, "could not write the clip: \(String(describing: writer.error))")
    return url
  }

  func testReportsSizeLengthAndSilence() async throws {
    let url = try writeClip(seconds: 2, size: CGSize(width: 128, height: 64))
    let measured = await VideoFacts.describe(uri: url.absoluteString)
    let facts = try XCTUnwrap(measured)

    XCTAssertEqual(facts.widthPx, 128)
    XCTAssertEqual(facts.heightPx, 64)
    XCTAssertEqual(facts.durationMs, 2_000, accuracy: 120)
    XCTAssertFalse(facts.hasSoundTrack, "a clip written with no audio track must not be reported as having sound")
    XCTAssertEqual(try XCTUnwrap(facts.frameRate), 30, accuracy: 1)
  }

  func testReportsAnUprightClipUpright() async throws {
    // Stored landscape with a quarter turn. Reporting the stored size would
    // call every upright phone export the wrong shape.
    let url = try writeClip(seconds: 1, size: CGSize(width: 128, height: 64), rotated: true)
    let measured = await VideoFacts.describe(uri: url.absoluteString)
    let facts = try XCTUnwrap(measured)

    XCTAssertEqual(facts.widthPx, 64)
    XCTAssertEqual(facts.heightPx, 128)
  }

  func testNothingMeasuredForAFileThatIsNotThere() async {
    let missing = directory.appendingPathComponent("absent.mp4")
    let measured = await VideoFacts.describe(uri: missing.absoluteString)
    XCTAssertNil(measured, "a file that cannot be opened is unchecked, and must not be reported as measured")
  }

  func testDictionaryLeavesOutAFrameRateItDoesNotHave() {
    let facts = VideoFacts.Measurement(
      widthPx: 1_920,
      heightPx: 1_080,
      frameRate: nil,
      durationMs: 6_600,
      hasSoundTrack: true
    )
    XCTAssertNil(facts.dictionary["frameRate"])
    XCTAssertEqual(facts.dictionary["widthPx"] as? Double, 1_920)
    XCTAssertEqual(facts.dictionary["hasSoundTrack"] as? Bool, true)
  }
}
