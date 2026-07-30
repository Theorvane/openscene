import {
  requestBytePlusImage,
  requestImagenImage,
  requestOpenAiImage,
  type ImageRequestInput
} from '../shared/imageGeneration';

/**
 * Node-side wrapper over the shared image adapters.
 *
 * The requests and the response parsing live in src/shared so the mobile app can
 * send the same calls; the only thing that cannot cross is Buffer, so that is the
 * only thing left here. Callers still own writing files.
 */

export { bytePlusSizeFor, imageExtensionFor, openAiSizeFor } from '../shared/imageGeneration';

export type ImageSynthesisInput = ImageRequestInput;

export type GeneratedImage = {
  readonly bytes: Buffer;
  readonly mimeType: string;
  readonly providerJobId: string;
};

function toBuffer(data: { readonly base64: string; readonly mimeType: string; readonly providerJobId: string }): GeneratedImage {
  return { ...data, bytes: Buffer.from(data.base64, 'base64') };
}

export async function generateOpenAiImage(input: ImageSynthesisInput): Promise<GeneratedImage> {
  return toBuffer(await requestOpenAiImage(input));
}

export async function generateImagenImage(input: ImageSynthesisInput): Promise<GeneratedImage> {
  return toBuffer(await requestImagenImage(input));
}

export async function generateBytePlusImage(input: ImageSynthesisInput): Promise<GeneratedImage> {
  return toBuffer(await requestBytePlusImage(input));
}
