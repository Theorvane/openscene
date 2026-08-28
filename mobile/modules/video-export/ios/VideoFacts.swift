import AVFoundation

/**
 What a finished file actually is.

 An export used to be reported as a success because the writer finished and a
 file existed. That is also what every truncated, silent or wrongly shaped
 export produced, so the file is read back and compared with the cut it came
 from — the comparison itself lives in the shared core, and this only measures.

 The reported size is the size after the track's transform, because a portrait
 recording is stored landscape with a quarter turn on it: measuring the stored
 size would call every phone export the wrong shape.

 Best-effort. A file that will not open comes back as nothing measured, which
 the shared rule reports as unchecked rather than as a fault — being unable to
 inspect a file says nothing about the file. Kept free of ExpoModulesCore so
 the macOS tests can run it, the way the composer and the peaks reader are.
 */
public enum VideoFacts {
  public struct Measurement: Equatable {
    public let widthPx: Int
    public let heightPx: Int
    public let frameRate: Double?
    public let durationMs: Double
    public let hasSoundTrack: Bool

    public init(widthPx: Int, heightPx: Int, frameRate: Double?, durationMs: Double, hasSoundTrack: Bool) {
      self.widthPx = widthPx
      self.heightPx = heightPx
      self.frameRate = frameRate
      self.durationMs = durationMs
      self.hasSoundTrack = hasSoundTrack
    }

    /** The shape the JS bridge hands to `reviewExport`. */
    public var dictionary: [String: Any] {
      var described: [String: Any] = [
        "widthPx": Double(widthPx),
        "heightPx": Double(heightPx),
        "durationMs": durationMs,
        "hasSoundTrack": hasSoundTrack
      ]
      // Left out rather than sent as zero: the review says nothing about a rate
      // it was not told, and zero would read as a stopped file.
      if let frameRate, frameRate > 0 {
        described["frameRate"] = frameRate
      }
      return described
    }
  }

  public static func describe(uri: String) async -> Measurement? {
    guard let url = URL(string: uri) ?? URL(string: "file://\(uri)") else { return nil }
    let asset = AVURLAsset(url: url)

    guard let duration = try? await asset.load(.duration), duration.isNumeric else { return nil }
    let durationMs = CMTimeGetSeconds(duration) * 1_000
    let audioTracks = (try? await asset.loadTracks(withMediaType: .audio)) ?? []

    guard let videoTracks = try? await asset.loadTracks(withMediaType: .video),
          let video = videoTracks.first else {
      // A file with sound and no picture is a measurement the review has
      // something to say about, not a failure to measure.
      return Measurement(
        widthPx: 0,
        heightPx: 0,
        frameRate: nil,
        durationMs: 0,
        hasSoundTrack: !audioTracks.isEmpty
      )
    }

    let naturalSize = (try? await video.load(.naturalSize)) ?? .zero
    let transform = (try? await video.load(.preferredTransform)) ?? .identity
    let presented = naturalSize.applying(transform)
    let nominalRate = (try? await video.load(.nominalFrameRate)) ?? 0

    return Measurement(
      widthPx: Int(abs(presented.width).rounded()),
      heightPx: Int(abs(presented.height).rounded()),
      frameRate: nominalRate > 0 ? Double(nominalRate) : nil,
      durationMs: durationMs,
      hasSoundTrack: !audioTracks.isEmpty
    )
  }
}
