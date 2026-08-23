import AVFoundation
import ExpoModulesCore
import UIKit

/**
 Renders a composition plan with AVFoundation.

 The plan arrives already ordered and resolved — bottom video layer first, each
 segment carrying its source range and timeline placement — because those rules
 live in `src/shared/videoCompositionPlan.ts` and are shared with the desktop.
 Nothing here decides what goes where; it only builds the AVFoundation objects
 that say it.
 */

struct SegmentInput: Record {
  @Field var uri: String = ""
  @Field var timelineStartMs: Double = 0
  @Field var sourceStartMs: Double = 0
  @Field var sourceEndMs: Double = 0
  @Field var gain: Double = 1
  /// What Adjust set. Defaults are "unchanged", so an older caller still renders.
  @Field var opacity: Double = 1
  @Field var scale: Double = 1
  @Field var offsetX: Double = 0
  @Field var offsetY: Double = 0
  @Field var rotationDegrees: Double = 0
  /// Playback rate. 1 is the rate it was shot at, and what an older caller means.
  @Field var speed: Double = 1
  /// Whether the source is a photograph, which has to be held rather than played.
  @Field var still: Bool = false
  /// The grade. Neutral is `0, 1, 1`, which is also what an older caller means.
  @Field var brightness: Double = 0
  @Field var contrast: Double = 1
  @Field var saturation: Double = 1
}

/// A transition, as the black it puts over the picture: total at the midpoint.
struct DipInput: Record {
  @Field var startMs: Double = 0
  @Field var durationMs: Double = 0
}

/// Words over the finished picture, in output-frame pixels from the centre.
struct TitleInput: Record {
  @Field var text: String = ""
  @Field var timelineStartMs: Double = 0
  @Field var timelineEndMs: Double = 0
  @Field var sizePx: Double = 72
  /// `#rrggbb`.
  @Field var color: String = "#ffffff"
  @Field var positionX: Double = 0
  @Field var positionY: Double = 0
}

struct ExportRequest: Record {
  @Field var width: Int = 1920
  @Field var height: Int = 1080
  @Field var frameRate: Int = 30
  @Field var durationMs: Double = 0
  @Field var videoSegments: [SegmentInput] = []
  @Field var audioSegments: [SegmentInput] = []
  @Field var dips: [DipInput] = []
  @Field var titles: [TitleInput] = []
}


public final class VideoExportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VideoExport")

    Property("isSupported") { true }

    /*
      The switch that lets a timeline with a photograph on it be exported.

      `areStillsRenderable` in the JS bridge reads this, and refuses the export
      where it is false — because a renderer that cannot hold a still opens it as
      a movie and contributes nothing, which is an export quietly shorter than
      the cut. True now that `stillMovie` encodes one before the composition is
      assembled.
    */
    Property("supportsStills") { true }

    AsyncFunction("exportComposition") { (request: ExportRequest) -> [String: Any] in
      try await Self.export(request)
    }

    AsyncFunction("extractFrame") { (uri: String, atMs: Double) -> [String: Any] in
      try await Self.extractFrame(uri: uri, atMs: atMs)
    }

    AsyncFunction("readAudioPeaks") { (uri: String, startMs: Double, endMs: Double, bars: Int) -> [Double] in
      await AudioPeaks.read(uri: uri, startMs: startMs, endMs: endMs, bars: bars)
    }
  }

  /**
   Pulls a single frame out of a clip as base64 JPEG.

   Used to hand the tail of one generated shot to the next as its first frame.
   It comes back as base64 rather than a file because that is what the provider
   APIs take, and writing a file only to read it straight back would be a
   round trip for nothing.
   */
  private static func extractFrame(uri: String, atMs: Double) async throws -> [String: Any] {
    guard let url = URL(string: uri) ?? URL(string: "file://\(uri)") else {
      throw Exception(name: "BadUri", description: "That is not a readable file URL.")
    }
    let asset = AVURLAsset(url: url)
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    // Without a tolerance the generator can fail on a frame that is not a
    // keyframe; a few hundredths either side of the requested time is
    // indistinguishable in a still and always succeeds.
    generator.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 20)
    generator.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 20)

    let duration = try await asset.load(.duration)
    let requested = atMs < 0
      // A negative time means "the last frame". Backing off a little from the
      // exact end matters: the final presentation time often has no decodable
      // frame at it, and asking for it returns an error rather than a picture.
      ? CMTimeSubtract(duration, CMTime(value: 1, timescale: 10))
      : CMTime(value: CMTimeValue(max(0, atMs).rounded()), timescale: 1000)

    let (image, actual) = try await generator.image(at: CMTimeMaximum(requested, .zero))
    let bitmap = UIImage(cgImage: image)
    guard let data = bitmap.jpegData(compressionQuality: 0.9) else {
      throw Exception(name: "EncodeFailed", description: "The frame could not be encoded as JPEG.")
    }
    return [
      "base64": data.base64EncodedString(),
      "mimeType": "image/jpeg",
      "atMs": CMTimeGetSeconds(actual) * 1000
    ]
  }

  /**
   The boundary, and nothing else.

   Records in, plain values out, and the composer's errors turned into the ones
   the JavaScript side knows. What gets rendered lives in `VideoComposer`, which
   has no Expo in it — so a macOS test can run the same code a phone runs, which
   is the only way anything here gets proven rather than merely compiled.
   */
  private static func export(_ request: ExportRequest) async throws -> [String: Any] {
    do {
      let output = try await VideoComposer.export(request.asComposerRequest())
      return ["uri": output.absoluteString, "durationMs": request.durationMs]
    } catch ComposerError.emptyComposition {
      throw Exception(name: "EmptyComposition", description: "The timeline has no media to export.")
    } catch ComposerError.exportUnavailable {
      throw Exception(name: "ExportUnavailable", description: "This device cannot create an export session.")
    } catch ComposerError.exportFailed(let reason) {
      throw Exception(name: "ExportFailed", description: reason)
    }
  }
}

/// Records are the bridge's shape; the composer takes plain values.
private extension SegmentInput {
  var asComposerSegment: ComposerSegment {
    ComposerSegment(
      uri: uri,
      timelineStartMs: timelineStartMs,
      sourceStartMs: sourceStartMs,
      sourceEndMs: sourceEndMs,
      gain: gain,
      opacity: opacity,
      scale: scale,
      offsetX: offsetX,
      offsetY: offsetY,
      rotationDegrees: rotationDegrees,
      speed: speed,
      still: still,
      colour: ComposerColour(brightness: brightness, contrast: contrast, saturation: saturation)
    )
  }
}

private extension ExportRequest {
  func asComposerRequest() -> ComposerRequest {
    ComposerRequest(
      width: width,
      height: height,
      frameRate: frameRate,
      durationMs: durationMs,
      videoSegments: videoSegments.map(\.asComposerSegment),
      audioSegments: audioSegments.map(\.asComposerSegment),
      dips: dips.map { ComposerDip(startMs: $0.startMs, durationMs: $0.durationMs) },
      titles: titles.map {
        ComposerTitle(
          text: $0.text,
          timelineStartMs: $0.timelineStartMs,
          timelineEndMs: $0.timelineEndMs,
          sizePx: $0.sizePx,
          color: $0.color,
          positionX: $0.positionX,
          positionY: $0.positionY
        )
      }
    )
  }
}
