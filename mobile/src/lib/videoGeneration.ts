import { File } from 'expo-file-system';

import {
  supportsReferenceImage,
  videoAdapterFor,
  type VideoAspectRatio,
  type VideoProgressStage
} from '@openvideo/shared/videoGeneration';
import { getDomainModel } from '@openvideo/shared/aiDomainModels';

import { estimateVideoCost } from '@openvideo/shared/mediaGenerationPricing';

import { readKey, type ProviderSlot } from './credentials';
import { chargeReservation, releaseReservation, reserveAgainstCap } from './spendLedger';
import { projectMediaDir, type MobileAsset } from './projectStore';
import videoExport, { isFrameExtractionAvailable } from '../../modules/video-export';

/**
 * Generates a shot and lands it in the project as an asset.
 *
 * The clip never passes through JavaScript. The shared adapter resolves a URL,
 * and `File.downloadFileAsync` streams it to disk natively — a ten-second 720p
 * clip is several megabytes, and reading that into a JS string to write it back
 * out would cost the memory twice for no benefit.
 */

const SLOTS: Readonly<Record<string, ProviderSlot>> = {
  openai: 'openaiApiKey',
  google_gemini: 'geminiApiKey',
  runway: 'runwayApiKey',
  luma: 'lumaApiKey'
};

export type GenerateShotInput = {
  readonly projectId: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly aspectRatio: VideoAspectRatio;
  readonly durationSeconds: number;
  /** First frame to continue from, usually the tail of the previous shot. */
  readonly referenceImage?: { readonly base64: string; readonly mimeType: string };
  readonly onProgress?: (stage: VideoProgressStage, elapsedMs: number) => void;
};

export type GenerateShotResult =
  | {
      readonly ok: true;
      readonly asset: MobileAsset;
      /** The clip's last frame, for the next shot to continue from. */
      readonly tailFrame?: { readonly base64: string; readonly mimeType: string };
    }
  | { readonly ok: false; readonly message: string };

export async function generateShot(input: GenerateShotInput): Promise<GenerateShotResult> {
  const model = getDomainModel('video-generation', input.modelId);
  if (model === undefined) return { ok: false, message: `${input.modelId} is not in the model catalog.` };

  const adapter = videoAdapterFor(model.providerId);
  const slot = SLOTS[model.providerId];
  if (adapter === undefined || slot === undefined) {
    return { ok: false, message: `${model.providerLabel} has no adapter on this device yet.` };
  }

  /*
    The monthly ceiling, before anything is asked of a provider.

    A shot sequence is the loop this is really for: each shot is approved once
    by whoever pressed the button, and then a plan of ten runs them all. The
    limit is what stops the tenth when the fourth already crossed it.
  */
  const estimate = estimateVideoCost({ modelId: model.id, durationSeconds: input.durationSeconds });
  const reservation = reserveAgainstCap(estimate, new Date().toISOString());
  if (!reservation.ok) return { ok: false, message: reservation.reason };

  const apiKey = await readKey(slot);
  if (apiKey === null) {
    // Nothing was asked of a provider, so the room goes back.
    releaseReservation(reservation.id);
    return { ok: false, message: `${model.providerLabel} is not connected. Add its key in Settings.` };
  }

  try {
    // A reference frame is dropped rather than sent to a provider that cannot
    // use it: the alternative is an error mid-sequence, after the earlier shots
    // have already been paid for.
    const seed =
      input.referenceImage !== undefined && supportsReferenceImage(model.providerId)
        ? input.referenceImage
        : undefined;

    // Kept as the request goes out: that is where the money is committed, and
    // a shot refused for a missing key cost nothing.
    chargeReservation(reservation.id);
    const ready = await adapter({
      apiKey,
      modelId: model.id,
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      ...(seed === undefined ? {} : { referenceImage: seed }),
      ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress })
    });

    const dir = projectMediaDir(input.projectId);
    if (!dir.exists) dir.create({ intermediates: true });
    const id = `asset-${Date.now().toString(36)}`;
    // The returned handle is the authority on what was written, not the one
    // passed in — a non-2xx rejects here and leaves no file behind.
    const written = await File.downloadFileAsync(ready.url, new File(dir, `${id}.mp4`), {
      headers: { ...ready.headers }
    });

    // A download that produced nothing is a failure however the request looked;
    // a zero-byte clip on the timeline would break the export instead.
    if (!written.exists || (written.size ?? 0) === 0) {
      return { ok: false, message: 'The provider returned an empty video.' };
    }

    // Read while the file is here, not when the next shot asks for it: the next
    // request is minutes away and the failure would land in the middle of a run.
    let tailFrame: { base64: string; mimeType: string } | undefined;
    if (isFrameExtractionAvailable) {
      try {
        const frame = await videoExport.extractFrame(written.uri, -1);
        tailFrame = { base64: frame.base64, mimeType: frame.mimeType };
      } catch {
        // A shot that generated is still a good shot; only the continuity of the
        // next one is lost, and the caller reports that rather than failing here.
      }
    }

    const dimensions = DIMENSIONS[input.aspectRatio];
    return {
      ok: true,
      ...(tailFrame === undefined ? {} : { tailFrame }),
      asset: {
        id,
        displayName: `${model.label} · ${input.durationSeconds}s`,
        kind: 'video',
        mimeType: ready.mimeType,
        relativePath: `media/${id}.mp4`,
        durationMs: input.durationSeconds * 1000,
        width: dimensions.width,
        height: dimensions.height
      }
    };
  } catch (error) {
    // Only takes back a reservation that is still pending, so a shot that
    // failed after the provider was called still counts as a charge.
    releaseReservation(reservation.id);
    return { ok: false, message: error instanceof Error ? error.message : 'Video generation failed.' };
  }
}

/**
 * What each provider renders at. Read from the request rather than the file
 * because neither adapter reports the finished dimensions, and guessing 1080p
 * would place clips on a canvas they do not fill.
 */
const DIMENSIONS: Readonly<Record<VideoAspectRatio, { readonly width: number; readonly height: number }>> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 720, height: 720 }
};
