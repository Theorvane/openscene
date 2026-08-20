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
}

/// A transition, as the black it puts over the picture: total at the midpoint.
struct DipInput: Record {
  @Field var startMs: Double = 0
  @Field var durationMs: Double = 0
}

struct ExportRequest: Record {
  @Field var width: Int = 1920
  @Field var height: Int = 1080
  @Field var frameRate: Int = 30
  @Field var durationMs: Double = 0
  @Field var videoSegments: [SegmentInput] = []
  @Field var audioSegments: [SegmentInput] = []
  @Field var dips: [DipInput] = []
}

private func time(_ milliseconds: Double) -> CMTime {
  CMTime(value: CMTimeValue(max(0, milliseconds).rounded()), timescale: 1000)
}

public final class VideoExportModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VideoExport")

    Property("isSupported") { true }

    AsyncFunction("exportComposition") { (request: ExportRequest) -> [String: Any] in
      try await Self.export(request)
    }

    AsyncFunction("extractFrame") { (uri: String, atMs: Double) -> [String: Any] in
      try await Self.extractFrame(uri: uri, atMs: atMs)
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

  private static func export(_ request: ExportRequest) async throws -> [String: Any] {
    if request.videoSegments.isEmpty && request.audioSegments.isEmpty {
      throw Exception(name: "EmptyComposition", description: "The timeline has no media to export.")
    }

    let composition = AVMutableComposition()
    let renderSize = CGSize(width: request.width, height: request.height)
    var layerInstructions: [AVMutableVideoCompositionLayerInstruction] = []

    // Each video segment gets its own track. Sharing one track would serialise
    // clips that are meant to overlap, which is exactly what a multi-track
    // timeline is for.
    for segment in request.videoSegments {
      guard let url = URL(string: segment.uri) ?? URL(string: "file://\(segment.uri)") else { continue }
      let asset = AVURLAsset(url: url)
      guard let sourceTrack = try await asset.loadTracks(withMediaCharacteristic: .visual).first else { continue }
      guard let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }

      let range = CMTimeRange(start: time(segment.sourceStartMs), end: time(segment.sourceEndMs))
      try track.insertTimeRange(range, of: sourceTrack, at: time(segment.timelineStartMs))

      /*
       Retiming, as a scale on what was just inserted.

       AVFoundation has no speed property; it has "make this range last that
       long", which is the same statement read the other way round. The range
       scaled is the one in *composition* time — where the clip was inserted,
       not where it came from — so it is built from the insertion point rather
       than from the source window.
       */
      let rate = max(0.01, segment.speed)
      if rate != 1 {
        let sourceSpan = segment.sourceEndMs - segment.sourceStartMs
        track.scaleTimeRange(
          CMTimeRange(start: time(segment.timelineStartMs), duration: time(sourceSpan)),
          toDuration: time(sourceSpan / rate)
        )
      }

      let instruction = AVMutableVideoCompositionLayerInstruction(assetTrack: track)

      /*
       What Adjust set, in the order the desktop's filter graph applies it:
       scale, then rotate, then place. These used to be dropped — the shared plan
       computed them and nothing on a phone read them — so opacity and scale
       changed a stored number and nothing anyone could see.

       Scale and rotation are taken about the clip's own centre rather than the
       origin, or enlarging a clip would also walk it off the frame; the clip is
       then centred in the render size and offset from there, which is what
       `overlay=(main_w-overlay_w)/2+x` means on the desktop.
       */
      let preferred = try await sourceTrack.load(.preferredTransform)
      let oriented = try await sourceTrack.load(.naturalSize).applying(preferred)
      let halfWidth = abs(oriented.width) / 2
      let halfHeight = abs(oriented.height) / 2
      let radians = CGFloat(segment.rotationDegrees) * .pi / 180
      let scale = CGFloat(max(0, segment.scale))

      var transform = preferred
      transform = transform.concatenating(CGAffineTransform(translationX: -halfWidth, y: -halfHeight))
      transform = transform.concatenating(CGAffineTransform(scaleX: scale, y: scale))
      transform = transform.concatenating(CGAffineTransform(rotationAngle: radians))
      transform = transform.concatenating(
        CGAffineTransform(
          translationX: renderSize.width / 2 + CGFloat(segment.offsetX),
          y: renderSize.height / 2 + CGFloat(segment.offsetY)
        )
      )
      instruction.setTransform(transform, at: .zero)
      let baseOpacity = Float(min(1, max(0, segment.opacity)))
      instruction.setOpacity(baseOpacity, at: .zero)

      /*
       Transitions, as opacity ramps on the clips either side of a cut.

       There is no cross-dissolve to do: the timeline refuses overlapping clips,
       so at no instant are there two pictures to mix. The outgoing clip going to
       nothing over black and the incoming one arriving is what the desktop draws
       and what the FFmpeg graph renders, and `setOpacityRamp` says exactly that.

       Clamped to the segment's own span, so a dip that reaches past the end of a
       clip ramps only over the part of it that exists.
       */
      let segmentStartMs = segment.timelineStartMs
      let segmentEndMs = segment.timelineStartMs + (segment.sourceEndMs - segment.sourceStartMs)
      for dip in request.dips where dip.durationMs > 0 {
        let midMs = dip.startMs + dip.durationMs / 2
        let endMs = dip.startMs + dip.durationMs

        let outStart = max(dip.startMs, segmentStartMs)
        if outStart < min(midMs, segmentEndMs) {
          instruction.setOpacityRamp(
            fromStartOpacity: baseOpacity,
            toEndOpacity: 0,
            timeRange: CMTimeRange(start: time(outStart), end: time(min(midMs, segmentEndMs)))
          )
        }

        let inEnd = min(endMs, segmentEndMs)
        if max(midMs, segmentStartMs) < inEnd {
          instruction.setOpacityRamp(
            fromStartOpacity: 0,
            toEndOpacity: baseOpacity,
            timeRange: CMTimeRange(start: time(max(midMs, segmentStartMs)), end: time(inEnd))
          )
        }
      }

      // The plan hands layers bottom-first, and AVFoundation draws the first
      // layer instruction on top — so the order is reversed when they are
      // assembled below rather than here.
      layerInstructions.append(instruction)
    }

    // Gain was read only as "is this audible at all"; the value itself was
    // dropped, so every clip played at full volume however it was set.
    var audioParameters: [AVMutableAudioMixInputParameters] = []
    for segment in request.audioSegments where segment.gain > 0 {
      guard let url = URL(string: segment.uri) ?? URL(string: "file://\(segment.uri)") else { continue }
      let asset = AVURLAsset(url: url)
      guard let sourceTrack = try await asset.loadTracks(withMediaType: .audio).first else { continue }
      guard let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { continue }
      let range = CMTimeRange(start: time(segment.sourceStartMs), end: time(segment.sourceEndMs))
      try track.insertTimeRange(range, of: sourceTrack, at: time(segment.timelineStartMs))

      // Sound follows the picture, scaled the same way it is. AVFoundation
      // resamples the audio rather than leaving it two seconds long behind a
      // picture that has already finished.
      let audioRate = max(0.01, segment.speed)
      if audioRate != 1 {
        let sourceSpan = segment.sourceEndMs - segment.sourceStartMs
        track.scaleTimeRange(
          CMTimeRange(start: time(segment.timelineStartMs), duration: time(sourceSpan)),
          toDuration: time(sourceSpan / audioRate)
        )
      }

      if segment.gain != 1 {
        let parameters = AVMutableAudioMixInputParameters(track: track)
        parameters.setVolume(Float(segment.gain), at: .zero)
        audioParameters.append(parameters)
      }
    }

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: time(request.durationMs))
    instruction.layerInstructions = layerInstructions.reversed()

    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, request.frameRate)))
    videoComposition.instructions = [instruction]

    let output = FileManager.default.temporaryDirectory
      .appendingPathComponent("openvideo-export-\(Int(Date().timeIntervalSince1970)).mp4")

    guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      throw Exception(name: "ExportUnavailable", description: "This device cannot create an export session.")
    }
    session.outputURL = output
    session.outputFileType = .mp4
    if !layerInstructions.isEmpty {
      session.videoComposition = videoComposition
    }
    // Built above and attached here: an audio mix that is never given to the
    // session is the same as no mix at all, which is how the gain went missing.
    if !audioParameters.isEmpty {
      let mix = AVMutableAudioMix()
      mix.inputParameters = audioParameters
      session.audioMix = mix
    }

    await session.export()

    // A cancelled or failed session leaves no usable file; reporting success
    // would hand the user a path to nothing.
    guard session.status == .completed else {
      throw Exception(
        name: "ExportFailed",
        description: session.error?.localizedDescription ?? "The export did not complete."
      )
    }

    return ["uri": output.absoluteString, "durationMs": request.durationMs]
  }
}
