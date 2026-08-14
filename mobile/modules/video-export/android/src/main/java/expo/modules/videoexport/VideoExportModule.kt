package expo.modules.videoexport

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
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
    val still: Boolean
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
          still = it["still"] as? Boolean ?: false
        )
      }
      .filter { it.uri.isNotEmpty() && it.sourceEndMs > it.sourceStartMs }
      .sortedBy { it.timelineStartMs }
  }

  private fun ms(value: Any?): Long = ((value as? Number)?.toDouble() ?: 0.0).roundToLong()

  /**
   * One sequence, with the holes stated.
   *
   * A gap is not the absence of an item — Media3 plays a sequence end to end, so
   * a clip starting at four seconds after one ending at two would simply follow
   * it immediately unless the two seconds between them are declared.
   */
  private fun sequenceOf(segments: List<Segment>, frameRate: Int, removeAudio: Boolean): EditedMediaItemSequence? {
    if (segments.isEmpty()) return null
    val builder = EditedMediaItemSequence.Builder()
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

  private fun itemOf(segment: Segment, frameRate: Int, removeAudio: Boolean): EditedMediaItem {
    val lengthMs = segment.sourceEndMs - segment.sourceStartMs
    if (segment.still) {
      // An image has no timeline to clip, so the length is the hold and the
      // frame rate is what turns one picture into that many frames.
      return EditedMediaItem.Builder(MediaItem.fromUri(normalise(segment.uri)))
        .setDurationUs(lengthMs * 1_000L)
        .setFrameRate(max(1, frameRate))
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
    if (overlaps(video)) {
      throw CodedException(
        "ERR_LAYERED_VIDEO",
        "Two video clips cover the same moment. Overlapping layers are not composited on Android yet — " +
          "put them on one track, or export on the desktop.",
        null
      )
    }

    val sequences = listOfNotNull(
      sequenceOf(video, frameRate, removeAudio = true),
      sequenceOf(audio, frameRate, removeAudio = false)
    )
    val composition = Composition.Builder(sequences)
      // The plan's width and height are the frame the whole cut is rendered
      // into, so it belongs on the composition rather than on any one item.
      .setEffects(
        Effects(
          emptyList(),
          listOf(Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_SCALE_TO_FIT))
        )
      )
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
