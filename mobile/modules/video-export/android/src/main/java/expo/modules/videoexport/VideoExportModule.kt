package expo.modules.videoexport

import android.graphics.Bitmap
import android.graphics.Color
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextureOverlay
import androidx.media3.effect.Crop
import androidx.media3.effect.Presentation
import androidx.media3.effect.RgbAdjustment
import androidx.media3.effect.ScaleAndRotateTransformation
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
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
 * Overlapping video is therefore the one thing this refuses. The plan flattens
 * every video track into one list, so two clips covering the same moment came
 * from two tracks and want compositing — which is a second sequence and a
 * compositor, not a bigger loop. Refusing names it; guessing would silently drop
 * a layer from someone's cut.
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
  }

  private data class Segment(
    val uri: String,
    val timelineStartMs: Long,
    val sourceStartMs: Long,
    val sourceEndMs: Long,
    val still: Boolean,
    /** What Adjust set. Defaults are "unchanged", so an older caller still renders. */
    val opacity: Float = 1f,
    val scale: Float = 1f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
    val rotationDegrees: Float = 0f,
    val gain: Float = 1f
  ) {
    val timelineEndMs: Long get() = timelineStartMs + (sourceEndMs - sourceStartMs)
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
          opacity = num(it["opacity"], 1f),
          scale = num(it["scale"], 1f),
          offsetX = num(it["offsetX"], 0f),
          offsetY = num(it["offsetY"], 0f),
          rotationDegrees = num(it["rotationDegrees"], 0f),
          gain = num(it["gain"], 1f)
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

  private fun sequenceOf(segments: List<Segment>, frameRate: Int, removeAudio: Boolean): EditedMediaItemSequence? {
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
      builder.addItem(itemOf(segment, frameRate, removeAudio))
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
  private fun itemOf(segment: Segment, frameRate: Int, removeAudio: Boolean): EditedMediaItem {
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
      if (segment.scale != 1f && segment.scale > 0f) {
        val half = 1f / segment.scale
        add(Crop(-half, half, -half, half))
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
    }
    // Gain, as a mixing matrix scaled by it — Media3's way of saying "quieter".
    val audio = buildList {
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

  private fun overlaps(segments: List<Segment>): Boolean =
    segments.zipWithNext().any { (first, second) -> second.timelineStartMs < first.timelineEndMs }

  private fun export(request: Map<String, Any?>): Map<String, Any> {
    val width = (request["width"] as? Number)?.toInt() ?: 1920
    val height = (request["height"] as? Number)?.toInt() ?: 1080
    val frameRate = (request["frameRate"] as? Number)?.toInt() ?: 30
    val video = segmentsOf(request, "videoSegments")
    val audio = segmentsOf(request, "audioSegments")

    if (video.isEmpty() && audio.isEmpty()) {
      throw CodedException("ERR_EMPTY_COMPOSITION", "The timeline has no media to export.", null)
    }
    // Said out loud rather than rendered wrong. A clip the user moved off centre
    // that comes back centred is exactly the silent-no-op this change exists to
    // remove, so it is refused where it can still be explained.
    val offset = video.firstOrNull { it.offsetX != 0f || it.offsetY != 0f }
    if (offset != null) {
      throw CodedException(
        "ERR_UNSUPPORTED_OFFSET",
        "A clip is positioned off centre, which this Android renderer cannot do yet. " +
          "Reset the clip's position, or export on the desktop.",
        null
      )
    }
    if (overlaps(video)) {
      throw CodedException(
        "ERR_LAYERED_VIDEO",
        "Two video clips cover the same moment. Overlapping layers are not composited on Android yet — " +
          "put them on one track, or export on the desktop.",
        null
      )
    }

    // Checked against the files, not against what the caller believed.
    val audible = audio.filter { hasAudio(it.uri) }
    val sequences = listOfNotNull(
      sequenceOf(video, frameRate, removeAudio = true),
      sequenceOf(audible, frameRate, removeAudio = false)
    )
    // Transitions are composition effects: a dip belongs over the finished
    // picture rather than inside one of the clips it joins.
    val dips = dipsOf(request)
    // One bitmap for every dip: they are all the same black, and a frame-sized
    // ARGB bitmap is not something to allocate once per cut.
    val dipOverlays = if (dips.isEmpty()) emptyList() else blackFrame(width, height).let { black -> dips.map { dipOverlay(it, black) } }
    val compositionEffects = buildList {
      // The plan's width and height are the frame the whole cut is rendered
      // into, so it belongs on the composition rather than on any one item.
      add(Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT))
      if (dipOverlays.isNotEmpty()) add(OverlayEffect(dipOverlays))
    }
    val composition = Composition.Builder(sequences)
      .setEffects(Effects(emptyList(), compositionEffects))
      .build()

    val output = File(hostContext.cacheDir, "openvideo-export-${System.currentTimeMillis()}.mp4")
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
