import AVFoundation
import CoreGraphics
import QuartzCore

/**
 Builds and runs the AVFoundation export, with nothing of Expo in it.

 The rendering rules used to live inside the module, which meant the only thing
 that could call them was a React Native app on a device — so the iOS renderer
 was the one of the three that was never run, only compiled. Every claim made
 about it in this repository was a source assertion: that a line exists, not
 that it works.

 Split out, the same code a phone runs can be run by a macOS test that exports a
 real file and measures it. The module above keeps the boundary — turning
 records into these plain inputs, turning these errors into `Exception`s — and
 nothing about what gets rendered lives there any more.

 The plan arrives already ordered and resolved — bottom video layer first, each
 segment carrying its source range and timeline placement — because those rules
 live in `src/shared/videoCompositionPlan.ts` and are shared with the desktop.
 Nothing here decides what goes where; it only builds the AVFoundation objects
 that say it.
 */

public struct ComposerSegment {
  public var uri: String
  public var timelineStartMs: Double
  public var sourceStartMs: Double
  public var sourceEndMs: Double
  public var gain: Double
  public var opacity: Double
  public var scale: Double
  public var offsetX: Double
  public var offsetY: Double
  public var rotationDegrees: Double
  public var speed: Double

  /// Defaults are "unchanged", so a caller that knows nothing of an effect still renders.
  public init(
    uri: String,
    timelineStartMs: Double = 0,
    sourceStartMs: Double = 0,
    sourceEndMs: Double = 0,
    gain: Double = 1,
    opacity: Double = 1,
    scale: Double = 1,
    offsetX: Double = 0,
    offsetY: Double = 0,
    rotationDegrees: Double = 0,
    speed: Double = 1
  ) {
    self.uri = uri
    self.timelineStartMs = timelineStartMs
    self.sourceStartMs = sourceStartMs
    self.sourceEndMs = sourceEndMs
    self.gain = gain
    self.opacity = opacity
    self.scale = scale
    self.offsetX = offsetX
    self.offsetY = offsetY
    self.rotationDegrees = rotationDegrees
    self.speed = speed
  }
}

/// A transition, as the black it puts over the picture: total at the midpoint.
public struct ComposerDip {
  public var startMs: Double
  public var durationMs: Double

  public init(startMs: Double, durationMs: Double) {
    self.startMs = startMs
    self.durationMs = durationMs
  }
}

/// Words over the finished picture, in output-frame pixels from the centre.
public struct ComposerTitle {
  public var text: String
  public var timelineStartMs: Double
  public var timelineEndMs: Double
  public var sizePx: Double
  /// `#rrggbb`.
  public var color: String
  public var positionX: Double
  public var positionY: Double

  public init(
    text: String,
    timelineStartMs: Double,
    timelineEndMs: Double,
    sizePx: Double = 72,
    color: String = "#ffffff",
    positionX: Double = 0,
    positionY: Double = 0
  ) {
    self.text = text
    self.timelineStartMs = timelineStartMs
    self.timelineEndMs = timelineEndMs
    self.sizePx = sizePx
    self.color = color
    self.positionX = positionX
    self.positionY = positionY
  }
}

public struct ComposerRequest {
  public var width: Int
  public var height: Int
  public var frameRate: Int
  public var durationMs: Double
  public var videoSegments: [ComposerSegment]
  public var audioSegments: [ComposerSegment]
  public var dips: [ComposerDip]
  public var titles: [ComposerTitle]

  public init(
    width: Int = 1920,
    height: Int = 1080,
    frameRate: Int = 30,
    durationMs: Double = 0,
    videoSegments: [ComposerSegment] = [],
    audioSegments: [ComposerSegment] = [],
    dips: [ComposerDip] = [],
    titles: [ComposerTitle] = []
  ) {
    self.width = width
    self.height = height
    self.frameRate = frameRate
    self.durationMs = durationMs
    self.videoSegments = videoSegments
    self.audioSegments = audioSegments
    self.dips = dips
    self.titles = titles
  }
}

public enum ComposerError: Error {
  case emptyComposition
  case exportUnavailable
  case exportFailed(String)
}

/**
 A `#rrggbb` string as a colour, falling back to white.

 A title in the wrong colour is a visible, fixable mistake; a refused export over
 one is not. Built from components rather than from `UIColor`, so the same code
 runs on the phone and on the macOS runner that tests it.
 */
func parseHexColor(_ value: String) -> CGColor {
  var hex = value
  if hex.hasPrefix("#") { hex.removeFirst() }
  let white = CGColor(colorSpace: CGColorSpaceCreateDeviceRGB(), components: [1, 1, 1, 1])!
  guard hex.count == 6, let rgb = UInt32(hex, radix: 16) else { return white }
  return CGColor(
    colorSpace: CGColorSpaceCreateDeviceRGB(),
    components: [
      CGFloat((rgb >> 16) & 0xff) / 255,
      CGFloat((rgb >> 8) & 0xff) / 255,
      CGFloat(rgb & 0xff) / 255,
      1
    ]
  ) ?? white
}

func time(_ milliseconds: Double) -> CMTime {
  CMTime(value: CMTimeValue(max(0, milliseconds).rounded()), timescale: 1000)
}

public enum VideoComposer {
  public static func export(_ request: ComposerRequest) async throws -> URL {
    if request.videoSegments.isEmpty && request.audioSegments.isEmpty {
      throw ComposerError.emptyComposition
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

    /*
     Titles, over the finished picture.

     Core Animation is how AVFoundation draws anything that is not a track, and a
     layer that is not in the tree for the whole composition needs its own
     timing: `beginTime` and `duration` on the layer, with the animation clock
     told not to run, so it appears exactly for its range and holds still.

     `AVCoreAnimationBeginTimeAtZero` rather than zero, because a Core Animation
     `beginTime` of zero means "now" and would place every title at the start.
     */
    if !request.titles.isEmpty {
      let parent = CALayer()
      parent.frame = CGRect(origin: .zero, size: renderSize)
      let videoLayer = CALayer()
      videoLayer.frame = parent.frame
      parent.addSublayer(videoLayer)

      for title in request.titles where !title.text.isEmpty && title.timelineEndMs > title.timelineStartMs {
        let text = CATextLayer()
        text.string = title.text
        text.fontSize = CGFloat(title.sizePx)
        text.foregroundColor = parseHexColor(title.color)
        text.alignmentMode = .center
        text.isWrapped = true
        text.contentsScale = 1
        // Centred, then offset, the way every other placement in the plan works.
        // Core Animation's y grows upward and the plan's grows downward.
        let height = CGFloat(title.sizePx) * 1.6
        text.frame = CGRect(
          x: 0,
          y: renderSize.height / 2 - height / 2 - CGFloat(title.positionY),
          width: renderSize.width,
          height: height
        )
        text.position = CGPoint(x: renderSize.width / 2 + CGFloat(title.positionX), y: text.position.y)

        text.beginTime = AVCoreAnimationBeginTimeAtZero + title.timelineStartMs / 1000
        text.duration = (title.timelineEndMs - title.timelineStartMs) / 1000
        text.isHidden = false
        text.speed = 0
        text.timeOffset = 0
        text.fillMode = .both
        parent.addSublayer(text)
      }

      videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(
        postProcessingAsVideoLayer: videoLayer,
        in: parent
      )
    }

    let output = FileManager.default.temporaryDirectory
      /*
        Unique, not merely timestamped.

        The name used to be the Unix time in *seconds*, so two exports finished
        within the same second collided — and `AVAssetExportSession` does not
        overwrite: it fails with "Cannot Save", which reads like a permissions
        problem and is not one. Found on the first CI run of these tests, which
        export four times in a few seconds; a phone hits it by exporting twice
        quickly, and the second one fails for no reason the user can see.
      */
      .appendingPathComponent("openvideo-export-\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString.prefix(8)).mp4")

    guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      throw ComposerError.exportUnavailable
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
      throw ComposerError.exportFailed(session.error?.localizedDescription ?? "The export did not complete.")
    }

    return output
  }
}
