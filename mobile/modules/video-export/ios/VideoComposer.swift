import AVFoundation
import CoreGraphics
import CoreImage
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
  /**
   Whether this source is a photograph rather than a movie.

   A still has no timeline of its own: opened the way a movie is opened it
   contributes a single frame, or nothing at all. It is held here for the length
   the clip asks for, which is what `-loop 1 -t` says on the desktop.
   */
  public var still: Bool
  public var colour: ComposerColour

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
    speed: Double = 1,
    still: Bool = false,
    colour: ComposerColour = ComposerColour()
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
    self.still = still
    self.colour = colour
  }
}

/**
 A clip's grade, in the units the shared plan uses.

 `brightness` is added and the other two multiply, which is what `eq` means on
 the desktop, what Media3's `Brightness` and `Contrast` mean on Android, and what
 `CIColorControls` means here — so the same three numbers describe the same
 picture on all three renderers.

 The neutral answer is the one that matters most: it has to render identically to
 a composition with no grade at all, because that is what lets every ungraded
 clip skip the compositor entirely.
 */
public struct ComposerColour: Equatable {
  public var brightness: Double
  public var contrast: Double
  public var saturation: Double

  public init(brightness: Double = 0, contrast: Double = 1, saturation: Double = 1) {
    self.brightness = brightness
    self.contrast = contrast
    self.saturation = saturation
  }

  /// Whether anything would change if the grade were skipped.
  public var isNeutral: Bool { brightness == 0 && contrast == 1 && saturation == 1 }
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

/**
 A photograph, written out as a movie of the length it has to be held for.

 `loadTracks(withMediaCharacteristic: .visual)` comes back empty for a PNG — a
 still has no visual *track* — so the export loop dropped the segment and the cut
 came out shorter than the timeline with nothing saying why. That is why mobile
 export refused a timeline containing one at all.

 Of the three ways to fix it, this is the one that leaves everything else alone.
 A Core Animation layer would change how the whole composition is assembled, and
 a custom compositor would have to reimplement the transform, the opacity and the
 ramps; encoding the still first makes it an ordinary source, so it picks up the
 trim, the retime, the placement and the transitions exactly as a movie does,
 with no second implementation of any of them to keep in step.

 Drawn at the image's own size, because that is what the desktop does: `-loop 1`
 feeds FFmpeg the photograph as it is and the same filter chain scales and places
 it. A still that filled the frame here and not there would be two pictures of
 one project.
 */
func stillMovie(at url: URL, holdingForMs milliseconds: Double, frameRate: Int, into directory: URL) throws -> URL {
  guard let image = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else {
    throw ComposerError.exportFailed("The still could not be read: \(url.lastPathComponent)")
  }

  // Even, because H.264 refuses odd dimensions, and bounded because a modern
  // phone photograph is far larger than any timeline renders at.
  let longest: CGFloat = 4096
  let fitted = min(1, longest / max(image.extent.width, image.extent.height))
  let width = max(2, Int((image.extent.width * fitted).rounded(.down)) & ~1)
  let height = max(2, Int((image.extent.height * fitted).rounded(.down)) & ~1)

  let output = directory.appendingPathComponent("openvideo-still-\(UUID().uuidString.prefix(8)).mp4")
  let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
  let input = AVAssetWriterInput(
    mediaType: .video,
    outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height
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

  var buffer: CVPixelBuffer?
  CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32BGRA, nil, &buffer)
  guard let pixels = buffer else {
    throw ComposerError.exportFailed("The still could not be prepared for encoding.")
  }
  let scale = CGAffineTransform(scaleX: CGFloat(width) / image.extent.width, y: CGFloat(height) / image.extent.height)
  CIContext().render(
    image.transformed(by: scale),
    to: pixels,
    bounds: CGRect(x: 0, y: 0, width: width, height: height),
    colorSpace: CGColorSpaceCreateDeviceRGB()
  )

  // The same frame at every tick. A one-frame movie stretched with
  // `scaleTimeRange` would be cheaper and is not the same thing: a decoder given
  // one frame and told it lasts ten seconds is a decoder holding a frame, and
  // players disagree about what that means.
  let rate = max(1, frameRate)
  let frames = max(1, Int((max(0, milliseconds) / 1000 * Double(rate)).rounded()))
  for frame in 0..<frames {
    while !input.isReadyForMoreMediaData { usleep(500) }
    adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: CMTimeScale(rate)))
  }
  input.markAsFinished()

  let finished = DispatchSemaphore(value: 0)
  writer.finishWriting { finished.signal() }
  finished.wait()
  guard writer.status == .completed else {
    throw ComposerError.exportFailed(writer.error?.localizedDescription ?? "The still could not be encoded.")
  }
  return output
}

/**
 One clip, as the compositor needs it: what to draw, where, how opaque, and what
 the grade does to it.

 This is the same description the layer instructions carry, written out because a
 custom compositor has to do their work itself — there is no way to keep them and
 add colour, since `AVMutableVideoCompositionLayerInstruction` has a transform and
 an opacity and nothing else in it.
 */
final class GradedLayer {
  let trackID: CMPersistentTrackID
  /// Built for AVFoundation's space, with y growing downward; converted per frame.
  let transform: CGAffineTransform
  let baseOpacity: Double
  let ramps: [OpacityRamp]
  let colour: ComposerColour

  init(trackID: CMPersistentTrackID, transform: CGAffineTransform, baseOpacity: Double, ramps: [OpacityRamp], colour: ComposerColour) {
    self.trackID = trackID
    self.transform = transform
    self.baseOpacity = baseOpacity
    self.ramps = ramps
    self.colour = colour
  }

  /**
   Opacity at a moment, with the same shape `setOpacityRamp` gives it: the base
   value until a ramp starts, interpolated inside one, and held at the ramp's end
   value afterwards until the next begins.
   */
  func opacity(at moment: CMTime) -> Double {
    let seconds = moment.seconds
    var value = baseOpacity
    for ramp in ramps.sorted(by: { $0.startSeconds < $1.startSeconds }) where ramp.startSeconds <= seconds {
      if seconds >= ramp.endSeconds {
        value = ramp.to
      } else {
        let span = max(0.000_001, ramp.endSeconds - ramp.startSeconds)
        value = ramp.from + (ramp.to - ramp.from) * ((seconds - ramp.startSeconds) / span)
      }
    }
    return min(1, max(0, value))
  }

  /**
   The transform in Core Image's terms.

   AVFoundation places a frame with the origin at the top left and y growing
   downward; Core Image's origin is at the bottom left and y grows upward. The
   same matrix in the other space is the source flipped, transformed, and flipped
   back — which is why this is a conversion rather than a second transform to
   keep in step with the first.
   */
  func coreImageTransform(sourceExtent: CGRect, renderSize: CGSize) -> CGAffineTransform {
    let flipSource = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: sourceExtent.height)
    let flipRender = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: renderSize.height)
    return flipSource.concatenating(transform).concatenating(flipRender)
  }
}

/// A transition ramp, in seconds, so the arithmetic per frame is not `CMTime`'s.
struct OpacityRamp {
  let startSeconds: Double
  let endSeconds: Double
  let from: Double
  let to: Double
}

/// The layers to draw for a stretch of the timeline, back to front.
final class GradingInstruction: NSObject, AVVideoCompositionInstructionProtocol {
  let timeRange: CMTimeRange
  let enablePostProcessing = false
  /// The opacity ramps change every frame, so no frame stands in for another.
  let containsTweening = true
  let requiredSourceTrackIDs: [NSValue]?
  let passthroughTrackID = kCMPersistentTrackID_Invalid
  let layers: [GradedLayer]

  init(timeRange: CMTimeRange, layers: [GradedLayer]) {
    self.timeRange = timeRange
    self.layers = layers
    self.requiredSourceTrackIDs = layers.map { NSNumber(value: $0.trackID) }
  }
}

/**
 The picture, drawn a frame at a time, because colour has to happen somewhere.

 Used only when at least one clip is graded. Everything else keeps the layer
 instructions: they are AVFoundation's own path, they cost nothing per frame, and
 an ungraded export should not become a Core Image render because the feature
 exists.

 Order matters and is the same order the desktop's filter graph uses — grade the
 clip, fade it, place it — and the layers arrive back to front, so each is drawn
 over what is already there.
 */
final class GradingCompositor: NSObject, AVVideoCompositing {
  let sourcePixelBufferAttributes: [String: any Sendable]? = [
    kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_32BGRA]
  ]
  let requiredPixelBufferAttributesForRenderContext: [String: any Sendable] = [
    kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_32BGRA]
  ]

  private let context = CIContext(options: [.useSoftwareRenderer: false])

  func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

  func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
    guard let instruction = request.videoCompositionInstruction as? GradingInstruction,
          let destination = request.renderContext.newPixelBuffer() else {
      request.finish(with: ComposerError.exportUnavailable)
      return
    }

    let renderSize = request.renderContext.size
    // Black underneath, which is what an empty stretch of timeline looks like on
    // every other renderer and what a dip fades to.
    var canvas = CIImage(color: CIColor(red: 0, green: 0, blue: 0)).cropped(to: CGRect(origin: .zero, size: renderSize))

    for layer in instruction.layers {
      guard let buffer = request.sourceFrame(byTrackID: layer.trackID) else { continue }
      var image = CIImage(cvPixelBuffer: buffer)
      let extent = image.extent

      if !layer.colour.isNeutral {
        image = image.applyingFilter(
          "CIColorControls",
          parameters: [
            kCIInputBrightnessKey: layer.colour.brightness,
            kCIInputContrastKey: layer.colour.contrast,
            kCIInputSaturationKey: layer.colour.saturation
          ]
        )
      }

      let alpha = layer.opacity(at: request.compositionTime)
      if alpha <= 0 { continue }
      if alpha < 1 {
        image = image.applyingFilter(
          "CIColorMatrix",
          parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: CGFloat(alpha))]
        )
      }

      image = image.transformed(by: layer.coreImageTransform(sourceExtent: extent, renderSize: renderSize))
      canvas = image.composited(over: canvas)
    }

    context.render(canvas, to: destination)
    request.finish(withComposedVideoFrame: destination)
  }
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
    /*
     The same description, twice, because the two paths cannot share one object.

     Layer instructions are AVFoundation's own compositing and cost nothing per
     frame, but they carry a transform and an opacity and no colour at all. A
     graded export therefore has to draw its own frames — see `GradingCompositor`
     — and an ungraded one should not pay for that. Which path runs is decided
     once, below, by whether any clip is actually graded.
     */
    var gradedLayers: [GradedLayer] = []

    // Each video segment gets its own track. Sharing one track would serialise
    // clips that are meant to overlap, which is exactly what a multi-track
    // timeline is for.
    /*
     Stills are encoded once, before anything is assembled, and cleaned up after.

     Written into a directory of their own so the export can delete the lot in
     one call rather than tracking each file — a temporary movie per still, left
     behind, is a photograph's worth of disk per export.
     */
    let stillsDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent("openvideo-stills-\(UUID().uuidString.prefix(8)))")
    if request.videoSegments.contains(where: { $0.still }) {
      try FileManager.default.createDirectory(at: stillsDirectory, withIntermediateDirectories: true)
    }
    defer { try? FileManager.default.removeItem(at: stillsDirectory) }

    for segment in request.videoSegments {
      guard let source = URL(string: segment.uri) ?? URL(string: "file://\(segment.uri)") else { continue }
      /*
       A photograph has no visual track, so `loadTracks` came back empty and the
       `guard` below dropped the segment — silently, leaving an export shorter
       than the cut with nothing saying why. Encoded first, it is an ordinary
       source and everything after this line treats it as one.

       Held for the source window rather than the timeline length: the frames are
       trimmed and then retimed, so a still played at 2× needs the material the
       trim asks for before the retime compresses it. That is the same number the
       desktop passes to `-t`.
       */
      let url: URL
      if segment.still {
        url = try stillMovie(
          at: source,
          holdingForMs: segment.sourceEndMs,
          frameRate: request.frameRate,
          into: stillsDirectory
        )
      } else {
        url = source
      }
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
      var ramps: [OpacityRamp] = []
      for dip in request.dips where dip.durationMs > 0 {
        let midMs = dip.startMs + dip.durationMs / 2
        let endMs = dip.startMs + dip.durationMs

        let outStart = max(dip.startMs, segmentStartMs)
        let outEnd = min(midMs, segmentEndMs)
        if outStart < outEnd {
          instruction.setOpacityRamp(
            fromStartOpacity: baseOpacity,
            toEndOpacity: 0,
            timeRange: CMTimeRange(start: time(outStart), end: time(outEnd))
          )
          ramps.append(OpacityRamp(startSeconds: outStart / 1000, endSeconds: outEnd / 1000, from: Double(baseOpacity), to: 0))
        }

        let inStart = max(midMs, segmentStartMs)
        let inEnd = min(endMs, segmentEndMs)
        if inStart < inEnd {
          instruction.setOpacityRamp(
            fromStartOpacity: 0,
            toEndOpacity: baseOpacity,
            timeRange: CMTimeRange(start: time(inStart), end: time(inEnd))
          )
          ramps.append(OpacityRamp(startSeconds: inStart / 1000, endSeconds: inEnd / 1000, from: 0, to: Double(baseOpacity)))
        }
      }

      gradedLayers.append(
        GradedLayer(
          trackID: track.trackID,
          transform: transform,
          baseOpacity: Double(baseOpacity),
          ramps: ramps,
          colour: segment.colour
        )
      )

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

    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, request.frameRate)))

    /*
     Two ways to draw the same picture, and the grade is what decides between
     them.

     Where nothing is graded — which is most exports — AVFoundation composites
     from the layer instructions built above, exactly as it did before colour
     existed. Where something is, `GradingCompositor` draws every frame through
     Core Image instead, because a layer instruction has no colour in it and
     there is no way to add one.

     Both are handed the same layers in the same order: the plan hands them
     bottom-first and AVFoundation draws the *first* layer instruction on top, so
     that list is reversed while the compositor's, which draws in order, is not.
     */
    let wholeTimeline = CMTimeRange(start: .zero, duration: time(request.durationMs))
    if request.videoSegments.contains(where: { !$0.colour.isNeutral }) {
      videoComposition.customVideoCompositorClass = GradingCompositor.self
      videoComposition.instructions = [GradingInstruction(timeRange: wholeTimeline, layers: gradedLayers)]
    } else {
      let instruction = AVMutableVideoCompositionInstruction()
      instruction.timeRange = wholeTimeline
      instruction.layerInstructions = layerInstructions.reversed()
      videoComposition.instructions = [instruction]
    }

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
