package expo.modules.videoexport

import android.graphics.Bitmap
import android.graphics.Color
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.ForegroundColorSpan
import android.util.Base64
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.Brightness
import androidx.media3.effect.Contrast
import androidx.media3.effect.HslAdjustment
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextureOverlay
import androidx.media3.effect.Crop
import androidx.media3.effect.Presentation
import androidx.media3.effect.RgbAdjustment
import androidx.media3.effect.TextOverlay
import androidx.media3.effect.ScaleAndRotateTransformation
import androidx.media3.effect.SpeedChangeEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/**
 * Android export, through Media3 Transformer.
 *
 * The plan is the shared one — `src/shared/videoCompositionPlan.ts` — so nothing
 * here decides what goes where. It decides only how to say it to Media3, the way
 * the iOS module says the same plan to AVFoundation.
 *
 * The shapes do not line up as neatly as they do on iOS. AVFoundation takes a
 * track per segment and composites them with layer instructions; Media3 takes
 * *sequences*, each a series of items played one after another, and composites
 * sequences against each other. A timeline's video track is naturally one
 * sequence, and the silence between clips has to be said out loud as a gap
 * rather than implied by a start time.
 *
 * Overlapping video used to be refused here for that reason: the plan flattened
 * every video track into one list, so two clips covering the same moment arrived
 * as one sequence that could only play them in turn. The plan now says which
 * layer each segment belongs to, bottom first, so a layer is a sequence and
 * Media3 composites the sequences against each other — which is what it does
 * with them anyway.
 */
@UnstableApi
class VideoExportModule : Module() {
  /** Expo hands the host context through `appContext`; there is no `context` here. */
  private val hostContext: android.content.Context
    get() = appContext.reactContext
      ?: throw CodedException("ERR_NO_CONTEXT", "The module has no Android context to export with.", null)

  override fun definition() = ModuleDefinition {
    Name("VideoExport")

    Property("isSupported") { true }

    /**
     * A still is held for its clip rather than seeked into, which Media3 says as
     * a duration and a frame rate on an image item. See `timelineStills` in the
     * shared core for why that is the whole rule.
     */
    Property("supportsStills") { true }

    AsyncFunction("exportComposition") { request: Map<String, Any?> ->
      export(request)
    }

    AsyncFunction("extractFrame") { uri: String, atMs: Double ->
      extractFrame(uri, atMs)
    }

    AsyncFunction("readAudioPeaks") { uri: String, startMs: Double, endMs: Double, bars: Int ->
      readAudioPeaks(uri, startMs, endMs, bars)
    }
  }

  private data class Segment(
    val uri: String,
    val timelineStartMs: Long,
    val sourceStartMs: Long,
    val sourceEndMs: Long,
    val still: Boolean,
    /** Which layer, bottom first: 0 is drawn under 1. One layer is one sequence. */
    val layer: Int = 0,
    /** What Adjust set. Defaults are "unchanged", so an older caller still renders. */
    val opacity: Float = 1f,
    val scale: Float = 1f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
    val rotationDegrees: Float = 0f,
    val gain: Float = 1f,
    /** Playback rate. 2 is twice as fast and half as long on the timeline. */
    val speed: Float = 1f,
    /** Colour. Neutral is 0, 1, 1 — added brightness, multiplied contrast and saturation. */
    val brightness: Float = 0f,
    val contrast: Float = 1f,
    val saturation: Float = 1f
  ) {
    // Length on the timeline, which at anything but 1× is not the length of the
    // source window. Everything that places or overlaps segments asks this.
    val timelineEndMs: Long get() = timelineStartMs + ((sourceEndMs - sourceStartMs) / max(0.01f, speed)).toLong()
  }

  @Suppress("UNCHECKED_CAST")
  private fun segmentsOf(request: Map<String, Any?>, key: String): List<Segment> {
    val raw = request[key] as? List<Map<String, Any?>> ?: emptyList()
    return raw
      .map {
        Segment(
          uri = it["uri"] as? String ?: "",
          timelineStartMs = ms(it["timelineStartMs"]),
          sourceStartMs = ms(it["sourceStartMs"]),
          sourceEndMs = ms(it["sourceEndMs"]),
          still = it["still"] as? Boolean ?: false,
          layer = (it["layer"] as? Number)?.toInt() ?: 0,
          opacity = num(it["opacity"], 1f),
          scale = num(it["scale"], 1f),
          offsetX = num(it["offsetX"], 0f),
          offsetY = num(it["offsetY"], 0f),
          rotationDegrees = num(it["rotationDegrees"], 0f),
          gain = num(it["gain"], 1f),
          speed = num(it["speed"], 1f),
          brightness = num(it["brightness"], 0f),
          contrast = num(it["contrast"], 1f),
          saturation = num(it["saturation"], 1f)
        )
      }
      .filter { it.uri.isNotEmpty() && it.sourceEndMs > it.sourceStartMs }
      .sortedBy { it.timelineStartMs }
  }

  private fun ms(value: Any?): Long = ((value as? Number)?.toDouble() ?: 0.0).roundToLong()

  /**
   * Whether a source actually has sound, asked of the file rather than believed.
   *
   * The caller says which assets it thinks are audible, but it is working from a
   * kind — "this is a video" — and a video can perfectly well be silent. Handing
   * Media3 a source with no audio track and asking it to keep only the audio
   * leaves nothing to encode, so the renderer checks the one thing it can check
   * directly. A file it cannot open is treated as silent, which loses sound that
   * was already unreachable rather than failing the export.
   */
  private fun hasAudio(uri: String): Boolean {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(hostContext, normalise(uri))
      retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes"
    } catch (error: Exception) {
      false
    } finally {
      try {
        retriever.release()
      } catch (error: Exception) {
        // Nothing to release, or already gone.
      }
    }
  }

  /** Absent means "leave it alone" rather than zero, which would erase the clip. */
  private fun num(value: Any?, fallback: Float): Float = (value as? Number)?.toFloat() ?: fallback

  /**
   * One sequence, with the holes stated.
   *
   * A gap is not the absence of an item — Media3 plays a sequence end to end, so
   * a clip starting at four seconds after one ending at two would simply follow
   * it immediately unless the two seconds between them are declared.
   */
  private data class Dip(val startMs: Long, val durationMs: Long)

  @Suppress("UNCHECKED_CAST")
  private fun dipsOf(request: Map<String, Any?>): List<Dip> {
    val raw = request["dips"] as? List<Map<String, Any?>> ?: emptyList()
    return raw
      .map { Dip(startMs = ms(it["startMs"]), durationMs = ms(it["durationMs"])) }
      .filter { it.durationMs > 0 }
  }

  /**
   * A transition, as black arriving over the whole picture and leaving again.
   *
   * Media3 has no cross-dissolve between two items in a sequence, and it does
   * not need one here: the timeline refuses overlapping clips, so there are
   * never two pictures to dissolve between. What the desktop draws — and what
   * the FFmpeg graph renders — is a dip through the black underneath, and a
   * black overlay whose alpha rises and falls is exactly that.
   *
   * A one-pixel bitmap, stretched over the frame by the overlay settings. The
   * alpha lives in `getOverlaySettings`, which Media3 calls per frame; the
   * bitmap never changes, which is deliberate — a bitmap that changes size or
   * disappears is what takes the frame processor down.
   */
  private fun dipOverlay(dip: Dip, black: Bitmap): TextureOverlay {
    val midMs = dip.startMs + dip.durationMs / 2

    return object : BitmapOverlay() {
      override fun getBitmap(presentationTimeUs: Long): Bitmap = black

      override fun getOverlaySettings(presentationTimeUs: Long): StaticOverlaySettings {
        val ms = presentationTimeUs / 1_000L
        val halfMs = dip.durationMs / 2f
        val distance = kotlin.math.abs(ms - midMs)
        // Total at the midpoint, nothing at either end, nothing outside.
        val alpha = if (halfMs <= 0f) 0f else max(0f, 1f - distance / halfMs)
        return StaticOverlaySettings.Builder().setAlphaScale(alpha).build()
      }
    }
  }

  /**
   * The black an overlay draws, at the size of the frame.
   *
   * A one-pixel bitmap scaled by the settings looked like the economical way to
   * do this and rendered nothing at all: an overlay is placed at its own pixel
   * size, so one pixel of black over a 1920-wide frame is one pixel of black.
   * The export finished, the file was the right length, and the cut did not dim
   * — a failure with nothing in the log to find. Measuring the frame found it.
   */
  private fun blackFrame(width: Int, height: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(max(1, width), max(1, height), Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.BLACK)
    return bitmap
  }

  private data class Title(
    val text: String,
    val startMs: Long,
    val endMs: Long,
    val sizePx: Int,
    val color: Int,
    val offsetX: Float,
    val offsetY: Float
  )

  @Suppress("UNCHECKED_CAST")
  private fun titlesOf(request: Map<String, Any?>): List<Title> {
    val raw = request["titles"] as? List<Map<String, Any?>> ?: emptyList()
    return raw
      .map {
        Title(
          text = it["text"] as? String ?: "",
          startMs = ms(it["timelineStartMs"]),
          endMs = ms(it["timelineEndMs"]),
          sizePx = num(it["sizePx"], 72f).toInt(),
          // A colour that will not parse is white rather than a failed export:
          // a title in the wrong colour is a visible, fixable mistake, and a
          // refused render over one is not.
          color = runCatching { Color.parseColor(it["color"] as? String ?: "#ffffff") }.getOrDefault(Color.WHITE),
          offsetX = num(it["positionX"], 0f),
          offsetY = num(it["positionY"], 0f)
        )
      }
      .filter { it.text.isNotEmpty() && it.endMs > it.startMs }
  }

  /**
   * A title, drawn only while it is meant to be on screen.
   *
   * The timing is alpha, not text. The obvious way to hide a caption outside its
   * range is to return an empty string from `getText` — and it does hide it, for
   * about two seconds, after which the export dies with "Video frame processing
   * error" and leaves a truncated file behind. Empty text is a zero-sized
   * bitmap, and the frame processor cannot draw one.
   *
   * So the text never changes and the *settings* do: `getOverlaySettings` is
   * called per frame, and outside the range it returns the same overlay at zero
   * alpha. The bitmap stays valid, and nothing is drawn because nothing is
   * opaque. Found by exporting on a device rather than by reading the API — the
   * failure is invisible to a typecheck and to every test in the suite.
   */
  private fun overlayFor(title: Title, width: Int, height: Int): TextureOverlay {
    val span = SpannableString(title.text)
    span.setSpan(ForegroundColorSpan(title.color), 0, span.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    span.setSpan(AbsoluteSizeSpan(title.sizePx), 0, span.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    // Anchors are fractions of the frame from its centre, and the offsets are
    // pixels of the output — so they are divided by half the frame to speak the
    // same units the rest of the plan does.
    fun settingsAt(alpha: Float): StaticOverlaySettings =
      StaticOverlaySettings.Builder()
        .setBackgroundFrameAnchor(
          if (width > 0) title.offsetX / (width / 2f) else 0f,
          if (height > 0) -title.offsetY / (height / 2f) else 0f
        )
        .setAlphaScale(alpha)
        .build()

    val shown = settingsAt(1f)
    val hidden = settingsAt(0f)

    return object : TextOverlay() {
      override fun getText(presentationTimeUs: Long): SpannableString = span

      override fun getOverlaySettings(presentationTimeUs: Long): StaticOverlaySettings {
        val ms = presentationTimeUs / 1_000L
        return if (ms in title.startMs until title.endMs) shown else hidden
      }
    }
  }

  private fun sequenceOf(segments: List<Segment>, frameRate: Int, removeAudio: Boolean, width: Int, height: Int): EditedMediaItemSequence? {
    if (segments.isEmpty()) return null
    val builder = EditedMediaItemSequence.Builder()

    /*
      A sequence that opens with silence has to say what kind of silence.

      Media3 refuses a leading gap outright — "If the first item in the sequence
      is a Gap, then forceAudioTrack or forceVideoTrack flag must be set" —
      because a gap on its own does not say whether the track it is padding
      carries pictures or sound. Every timeline whose first clip does not start
      at zero hit this, which is most of them the moment anyone moves a clip.
    */
    if (segments.first().timelineStartMs > 0) {
      if (removeAudio) builder.experimentalSetForceVideoTrack(true)
      else builder.experimentalSetForceAudioTrack(true)
    }

    var cursorMs = 0L
    for (segment in segments) {
      if (segment.timelineStartMs > cursorMs) {
        builder.addGap((segment.timelineStartMs - cursorMs) * 1_000L)
      }
      builder.addItem(itemOf(segment, frameRate, removeAudio, width, height))
      cursorMs = segment.timelineEndMs
    }
    return builder.build()
  }

  /**
   * What Adjust set, as Media3 effects.
   *
   * These used to be dropped: the shared plan computed them, the desktop honoured
   * them, and nothing on a phone applied them — so opacity and scale changed a
   * stored number and nothing anyone could see. The order matches the filter
   * graph the desktop builds: scale and rotate the picture, then fade it.
   *
   * `offsetX/Y` are deliberately absent. Media3 has no single-effect equivalent
   * of the desktop's `overlay=x:y`, and a clip silently rendered centred when the
   * user moved it is the failure this whole change is about — so an export that
   * would need one is refused by name instead.
   */
  private fun itemOf(
    segment: Segment,
    frameRate: Int,
    removeAudio: Boolean,
    // The output frame, because an offset measured in its pixels cannot be
    // turned into normalised coordinates without knowing how big it is.
    width: Int,
    height: Int
  ): EditedMediaItem {
    val lengthMs = segment.sourceEndMs - segment.sourceStartMs
    val video = buildList {
      if (segment.rotationDegrees != 0f) {
        add(ScaleAndRotateTransformation.Builder().setRotationDegrees(segment.rotationDegrees).build())
      }

      /*
        Scale is a crop, not a scale.

        `ScaleAndRotateTransformation.setScale` resizes the frame, and the
        `Presentation` that fixes the output size then fits it straight back —
        so the picture came out exactly as it went in and the control looked
        dead. Cropping to `1/scale` of the frame and letting the same
        Presentation fill the output is the zoom the user asked for, expressed
        where it survives. Values past the edge pad rather than crop, which is
        what scaling below 100% should do.
      */
      /*
        Scale and offset are one crop, because they are one question: which part
        of the frame ends up filling the output.

        Media3 has no translate effect. Moving the crop window is the same thing
        read the other way round — select a window centred left of the middle and
        the picture lands right of it — and the padding that makes scaling below
        100% work is what makes an offset past the edge work too.

        The plan measures offsets in output pixels with y growing downward, the
        way `overlay` does on the desktop; NDC is half-frames with y growing up.
        Hence the division by half the frame, and the sign flip on y.
      */
      val scale = if (segment.scale > 0f) segment.scale else 1f
      val halfX = 1f / scale
      val halfY = 1f / scale
      val shiftX = if (width > 0) segment.offsetX / (width / 2f) else 0f
      val shiftY = if (height > 0) segment.offsetY / (height / 2f) else 0f
      if (scale != 1f || shiftX != 0f || shiftY != 0f) {
        add(Crop(-halfX - shiftX, halfX - shiftX, -halfY + shiftY, halfY + shiftY))
      }

      /*
        Opacity is a multiply, not an alpha.

        `AlphaScale` sets a channel the encoder then discards: with one sequence
        there is nothing to composite against, so the frame arrived at full
        strength. Compositing over black at alpha `a` *is* multiplying RGB by
        `a`, which is also what the desktop's `colorchannelmixer=aa` produces
        once its `overlay` lands on a black base.
      */
      if (segment.opacity != 1f) {
        val level = max(0f, min(1f, segment.opacity))
        add(
          RgbAdjustment.Builder()
            .setRedScale(level)
            .setGreenScale(level)
            .setBlueScale(level)
            .build()
        )
      }
      /*
        Colour before the fade, so the grade lands on the picture rather than on
        a picture already multiplied towards black — a clip at 50% opacity and
        raised brightness is a brightened clip that is then faded, which is the
        order the desktop's `eq` sits in too.

        Media3 has these three as separate effects; applying none of them when a
        clip is neutral keeps an ungraded export byte-comparable with one made
        before colour existed.
      */
      if (segment.brightness != 0f) add(Brightness(segment.brightness))
      if (segment.contrast != 1f) {
        // Media3's `Contrast` is centred on zero, where the plan's is centred on
        // one: 1.4 in the plan is 0.4 here.
        add(Contrast(segment.contrast - 1f))
      }
      if (segment.saturation != 1f) {
        add(
          HslAdjustment.Builder()
            // The same off-by-one-hundred: the builder takes a percentage
            // change, so 0.5 in the plan is -50 here and 1.5 is +50.
            .adjustSaturation((segment.saturation - 1f) * 100f)
            .build()
        )
      }
      // Retiming last, so the geometry above is applied to the frames rather
      // than to a stream whose timestamps have already been rewritten.
      //
      // No `AlphaScale` here: opacity is a multiply now, because the encoder
      // discards an alpha channel it has nothing to composite against. That fix
      // arrived separately and the rebase tried to bring the old line back.
      if (segment.speed != 1f) add(SpeedChangeEffect(max(0.01f, segment.speed)))
    }
    // Gain, as a mixing matrix scaled by it — Media3's way of saying "quieter".
    val audio = buildList {
      // Sound follows the picture: a clip at 2× whose audio still runs at 1× is
      // a sync bug that reads as a broken export. Sonic resamples rather than
      // resampling the pitch with it, which is what an editor means by speed.
      if (segment.speed != 1f) add(SonicAudioProcessor().apply { setSpeed(max(0.01f, segment.speed)) })
      if (segment.gain != 1f) {
        add(
          ChannelMixingAudioProcessor().apply {
            for (channels in 1..2) {
              putChannelMixingMatrix(
                ChannelMixingMatrix.create(channels, channels).scaleBy(max(0f, segment.gain))
              )
            }
          }
        )
      }
    }

    if (segment.still) {
      // An image has no timeline to clip, so the length is the hold and the
      // frame rate is what turns one picture into that many frames.
      return EditedMediaItem.Builder(MediaItem.fromUri(normalise(segment.uri)))
        .setDurationUs(lengthMs * 1_000L)
        .setFrameRate(max(1, frameRate))
        .setEffects(Effects(audio, video))
        .build()
    }
    val media = MediaItem.Builder()
      .setUri(normalise(segment.uri))
      .setClippingConfiguration(
        MediaItem.ClippingConfiguration.Builder()
          .setStartPositionMs(segment.sourceStartMs)
          .setEndPositionMs(segment.sourceEndMs)
          .build()
      )
      .build()
    return EditedMediaItem.Builder(media)
      .setRemoveAudio(removeAudio)
      .setRemoveVideo(!removeAudio)
      .setEffects(Effects(audio, video))
      .build()
  }

  /** `file://` is what the JS side hands over; Media3 wants a parseable Uri either way. */
  private fun normalise(uri: String): Uri =
    if (uri.startsWith("file://") || uri.startsWith("content://")) Uri.parse(uri)
    else Uri.fromFile(File(uri))

  /**
   * Two clips of one layer covering the same moment.
   *
   * Within a layer this cannot be composited and cannot be played in turn — a
   * sequence is one item after another — so it stays refused. Across layers it
   * is the ordinary case now, and each layer gets its own sequence.
   */
  private fun overlapsWithinALayer(segments: List<Segment>): Boolean =
    segments
      .groupBy { it.layer }
      .values
      .any { layer -> layer.sortedBy { it.timelineStartMs }.zipWithNext().any { (first, second) -> second.timelineStartMs < first.timelineEndMs } }

  private fun export(request: Map<String, Any?>): Map<String, Any> {
    val width = (request["width"] as? Number)?.toInt() ?: 1920
    val height = (request["height"] as? Number)?.toInt() ?: 1080
    val frameRate = (request["frameRate"] as? Number)?.toInt() ?: 30
    val video = segmentsOf(request, "videoSegments")
    val audio = segmentsOf(request, "audioSegments")

    if (video.isEmpty() && audio.isEmpty()) {
      throw CodedException("ERR_EMPTY_COMPOSITION", "The timeline has no media to export.", null)
    }
    if (overlapsWithinALayer(video)) {
      throw CodedException(
        "ERR_LAYERED_VIDEO",
        "Two clips on the same track cover the same moment, which no renderer can draw. " +
          "Move one of them to a track of its own.",
        null
      )
    }

    // Checked against the files, not against what the caller believed.
    val audible = audio.filter { hasAudio(it.uri) }
    /*
      One sequence per layer, bottom first.

      A Media3 sequence plays its items in turn, so a layer is exactly what fits
      in one — and `Composition` composites the sequences it is given, drawing
      each over the ones before it. That is the same stacking order the plan hands
      every renderer, so a cut looks the same here, on iOS and on the desktop.
    */
    val videoSequences = video
      .groupBy { it.layer }
      .toSortedMap()
      .values
      .mapNotNull { layer -> sequenceOf(layer.sortedBy { it.timelineStartMs }, frameRate, removeAudio = true, width = width, height = height) }
    val sequences = videoSequences + listOfNotNull(
      sequenceOf(audible, frameRate, removeAudio = false, width = width, height = height)
    )
    // Transitions are composition effects: a dip belongs over the finished
    // picture rather than inside one of the clips it joins.
    val dips = dipsOf(request)
    // One bitmap for every dip: they are all the same black, and a frame-sized
    // ARGB bitmap is not something to allocate once per cut.
    val dipOverlays = if (dips.isEmpty()) emptyList() else blackFrame(width, height).let { black -> dips.map { dipOverlay(it, black) } }
    // Titles are composition effects, not item effects: a caption belongs over
    // the finished picture rather than inside one clip of it.
    val overlays = titlesOf(request).map { overlayFor(it, width, height) }
    val compositionEffects = buildList {
      // The plan's width and height are the frame the whole cut is rendered
      // into, so it belongs on the composition rather than on any one item.
      add(Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT))
      // Dips first, then titles: effects apply in order, so a caption stays
      // readable through a dip to black. That is what the FFmpeg graph draws
      // and what the program monitor shows, and the three have to agree.
      if (dipOverlays.isNotEmpty()) add(OverlayEffect(dipOverlays))
      if (overlays.isNotEmpty()) add(OverlayEffect(overlays))
    }
    val composition = Composition.Builder(sequences)
      .setEffects(Effects(emptyList(), compositionEffects))
      .build()

    // Unique rather than merely timestamped, for the reason iOS is: a name that
    // is only a clock reading collides when two exports land in the same tick,
    // and the second one fails for no reason a user can see.
    val output = File(
      hostContext.cacheDir,
      "openvideo-export-${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}.mp4"
    )
    val done = CountDownLatch(1)
    var failure: Exception? = null

    // Transformer must be built and started on a thread with a prepared Looper,
    // and Expo runs this on neither the main thread nor one that has any — so
    // the work is posted to the main looper and this thread waits for it.
    Handler(Looper.getMainLooper()).post {
      try {
        Transformer.Builder(hostContext)
          .setVideoMimeType(MimeTypes.VIDEO_H264)
          .setAudioMimeType(MimeTypes.AUDIO_AAC)
          .addListener(
            object : Transformer.Listener {
              override fun onCompleted(composition: Composition, result: ExportResult) {
                done.countDown()
              }

              override fun onError(composition: Composition, result: ExportResult, exception: ExportException) {
                failure = exception
                done.countDown()
              }
            }
          )
          .build()
          .start(composition, output.absolutePath)
      } catch (error: Exception) {
        failure = error
        done.countDown()
      }
    }

    // Long enough for a real cut on a slow device, short enough that a wedged
    // encoder does not hang the app forever.
    if (!done.await(30, TimeUnit.MINUTES)) {
      throw CodedException("ERR_EXPORT_TIMEOUT", "The export did not finish in time.", null)
    }
    failure?.let {
      throw CodedException("ERR_EXPORT_FAILED", it.message ?: "The export failed.", it)
    }

    return mapOf(
      "uri" to Uri.fromFile(output).toString(),
      "durationMs" to (request["durationMs"] as? Number ?: 0).toDouble()
    )
  }

  /**
   * The shape of a sound, as one number per bar.
   *
   * Decoded rather than estimated: there is no metadata for loudness, so the
   * only way to know where the beat is, is to read the samples. The decoder is
   * asked for the clip's own window and the samples are folded into buckets as
   * they arrive, so a long file costs a pass and not a copy of itself in memory.
   *
   * Peak rather than average per bucket, because a waveform is drawn to be
   * looked at: the loudest moment in a bar is what the eye is looking for, and
   * an average of a busy passage flattens into a wall.
   *
   * Best-effort. Anything that will not decode comes back empty and the clip is
   * drawn the way it was before waveforms existed.
   */
  private fun readAudioPeaks(uri: String, startMs: Double, endMs: Double, bars: Int): List<Double> {
    val wanted = max(1, min(4_000, bars))
    val spanUs = ((endMs - startMs) * 1_000).toLong()
    if (spanUs <= 0) return emptyList()

    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(uri.removePrefix("file://"))
      val track = (0 until extractor.trackCount).firstOrNull { index ->
        extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: return emptyList()

      extractor.selectTrack(track)
      extractor.seekTo((startMs * 1_000).toLong(), MediaExtractor.SEEK_TO_CLOSEST_SYNC)
      val format = extractor.getTrackFormat(track)
      val mime = format.getString(MediaFormat.KEY_MIME) ?: return emptyList()
      codec = MediaCodec.createDecoderByType(mime)
      codec.configure(format, null, null, 0)
      codec.start()

      val peaks = DoubleArray(wanted)
      val info = MediaCodec.BufferInfo()
      var sawInput = false
      var sawOutput = false

      while (!sawOutput) {
        if (!sawInput) {
          val index = codec.dequeueInputBuffer(10_000)
          if (index >= 0) {
            val buffer = codec.getInputBuffer(index)
            val size = if (buffer == null) -1 else extractor.readSampleData(buffer, 0)
            if (size < 0) {
              codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              sawInput = true
            } else {
              codec.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
              // Past the clip's window there is nothing left to draw, so the
              // read stops rather than decoding the rest of the file.
              if (extractor.sampleTime > (endMs * 1_000).toLong()) {
                sawInput = true
              } else {
                extractor.advance()
              }
            }
          }
        }

        val out = codec.dequeueOutputBuffer(info, 10_000)
        if (out >= 0) {
          val buffer = codec.getOutputBuffer(out)
          if (buffer != null && info.size > 0) {
            /*
              Each sample goes in the bucket its own moment falls in.

              One bucket per buffer puts a whole buffer's loudest sample
              wherever that buffer started, so a chunk straddling a boundary
              smears a loud passage back over a quiet one. The iOS reader had
              the same fault and CI measured it: a third of full scale in a half
              that was meant to be silent.
            */
            val outputFormat = codec.outputFormat
            val rate = outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE, 44_100).toDouble()
            val channels = outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT, 1).coerceAtLeast(1)
            val bufferStartUs = info.presentationTimeUs - (startMs * 1_000).toLong()
            val shorts = buffer.order(ByteOrder.nativeOrder()).asShortBuffer()
            // Every fiftieth sample: a peak does not move meaningfully between
            // neighbours, and reading them all is the difference between a
            // waveform that appears and one that arrives late.
            var index = 0
            while (index < shorts.limit()) {
              val frame = index / channels
              val positionUs = bufferStartUs + (frame * 1_000_000.0 / rate)
              val position = positionUs / spanUs
              if (position >= 0 && position < 1) {
                val bucket = (position * wanted).toInt().coerceIn(0, wanted - 1)
                val value = abs(shorts.get(index).toInt()) / 32_768.0
                if (value > peaks[bucket]) peaks[bucket] = value
              }
              index += 50
            }
          }
          codec.releaseOutputBuffer(out, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) sawOutput = true
        } else if (out == MediaCodec.INFO_TRY_AGAIN_LATER && sawInput) {
          // The decoder has nothing more coming and nothing more to give.
          sawOutput = true
        }
      }
      return peaks.toList()
    } catch (error: Exception) {
      // A file that will not decode is not an error anyone can act on: the clip
      // is simply drawn the way it was before waveforms existed.
      return emptyList()
    } finally {
      try {
        codec?.stop()
        codec?.release()
      } catch (error: Exception) {
        // Already gone.
      }
      extractor.release()
    }
  }

  private fun extractFrame(uri: String, atMs: Double): Map<String, Any> {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(uri.removePrefix("file://"))
      val durationMs =
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      // A negative time means "the last frame". Backing off a little from the
      // exact end matters: the final presentation time often has no decodable
      // frame at it, and asking for it returns null rather than a picture.
      val targetMs = if (atMs < 0) maxOf(0L, durationMs - 100L) else atMs.toLong()
      // CLOSEST rather than CLOSEST_SYNC: a sync-frame-only seek can land
      // seconds short of the end of a shot, which is the wrong picture to hand
      // to the next one.
      val frame: Bitmap =
        retriever.getFrameAtTime(targetMs * 1000L, MediaMetadataRetriever.OPTION_CLOSEST)
          ?: throw CodedException("ERR_NO_FRAME", "No frame could be read at that time.", null)

      val bytes = ByteArrayOutputStream()
      frame.compress(Bitmap.CompressFormat.JPEG, 90, bytes)
      return mapOf(
        "base64" to Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP),
        "mimeType" to "image/jpeg",
        "atMs" to targetMs.toDouble()
      )
    } finally {
      retriever.release()
    }
  }
}
