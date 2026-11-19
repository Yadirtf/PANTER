// Comprime la foto con expo-image-manipulator: ~1600 px de lado mayor y JPEG 0,8.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { DOCUMENT_JPEG_QUALITY, resizeFor } from '../documents/image-plan';

export interface CapturedPhoto {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export async function compressDocumentPhoto(photo: CapturedPhoto): Promise<CapturedPhoto> {
  const context = ImageManipulator.manipulate(photo.uri);
  const resize = resizeFor(photo.width, photo.height);
  if (resize) context.resize(resize);
  const image = await context.renderAsync();
  const result = await image.saveAsync({
    compress: DOCUMENT_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });
  return { uri: result.uri, width: result.width, height: result.height };
}
