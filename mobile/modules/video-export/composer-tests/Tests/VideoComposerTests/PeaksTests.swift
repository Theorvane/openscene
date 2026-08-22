import AVFoundation
import XCTest

@testable import VideoComposer

/**
 The reader that says where a sound is loud.

 A waveform drawn from peaks nobody checked is a decoration: it would look
 plausible whatever the file contained. These write a clip whose loudness is
 known — silence, then a tone — and check the reading follows it.
 */
final class PeaksTests: XCTestCase {
  private var directory: URL!

  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: directory)
  }

  /// Two seconds: the first silent, the second a tone.
  private func writeHalfSilentTone() throws -> URL {
    let url = directory.appendingPathComponent("tone.m4a")
    let writer = try AVAssetWriter(outputURL: url, fileType: .m4a)
    let rate = 44_100.0
    let input = AVAssetWriterInput(
      mediaType: .audio,
      outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: rate,
        AVNumberOfChannelsKey: 1,
        AVEncoderBitRateKey: 64_000
      ]
    )
    writer.add(input)
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)

    var format: CMFormatDescription?
    var description = AudioStreamBasicDescription(
      mSampleRate: rate,
      mFormatID: kAudioFormatLinearPCM,
      mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
      mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2,
      mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0
    )
    CMAudioFormatDescriptionCreate(allocator: nil, asbd: &description, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &format)

    let frames = Int(rate)
    for second in 0..<2 {
      var samples = [Int16](repeating: 0, count: frames)
      if second == 1 {
        for frame in 0..<frames {
          samples[frame] = Int16(sin(Double(frame) / rate * 440 * 2 * .pi) * 20_000)
        }
      }
      var block: CMBlockBuffer?
      let bytes = frames * MemoryLayout<Int16>.size
      CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: bytes, blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: bytes, flags: 0, blockBufferOut: &block)
      samples.withUnsafeBytes { raw in
        _ = CMBlockBufferReplaceDataBytes(with: raw.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0, dataLength: bytes)
      }
      var sample: CMSampleBuffer?
      var timing = CMSampleTimingInfo(
        duration: CMTime(value: 1, timescale: CMTimeScale(rate)),
        presentationTimeStamp: CMTime(value: CMTimeValue(second * frames), timescale: CMTimeScale(rate)),
        decodeTimeStamp: .invalid
      )
      CMSampleBufferCreateReady(allocator: nil, dataBuffer: block, formatDescription: format, sampleCount: frames, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 1, sampleSizeArray: [MemoryLayout<Int16>.size], sampleBufferOut: &sample)
      while !input.isReadyForMoreMediaData { usleep(1000) }
      if let ready = sample { input.append(ready) }
    }

    input.markAsFinished()
    let done = expectation(description: "written")
    writer.finishWriting { done.fulfill() }
    wait(for: [done], timeout: 30)
    XCTAssertEqual(writer.status, .completed, "could not write the tone: \(String(describing: writer.error))")
    return url
  }

  func testReadsLoudWhereTheToneIsAndQuietWhereItIsNot() async throws {
    let url = try writeHalfSilentTone()
    let peaks = await AudioPeaks.read(uri: url.absoluteString, startMs: 0, endMs: 2_000, bars: 20)

    XCTAssertEqual(peaks.count, 20)
    let firstHalf = peaks.prefix(10).max() ?? 0
    let secondHalf = peaks.suffix(10).max() ?? 0
    XCTAssertGreaterThan(secondHalf, 0.2, "the tone should read as loud")
    XCTAssertLessThan(firstHalf, secondHalf / 2, "the silence should read quieter than the tone")
  }

  func testComesBackEmptyForSomethingItCannotRead() async {
    let peaks = await AudioPeaks.read(uri: "file:///nowhere/none.m4a", startMs: 0, endMs: 1_000, bars: 10)
    XCTAssertTrue(peaks.isEmpty, "an unreadable file leaves the clip drawn as it was")
  }
}
