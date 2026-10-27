import * as ImagePicker from 'expo-image-picker';
import type { ApiClient } from './api';
import { photoUpload } from './schemas';

export const PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type Facing = 'front' | 'back';

export type PhotoFailure = 'PERMISSION_DENIED' | 'TOO_LARGE' | 'BAD_TYPE' | 'UNAVAILABLE';
export class PhotoError extends Error {
  constructor(
    public readonly kind: PhotoFailure,
    public readonly canAskAgain = false,
  ) {
    super(kind);
    this.name = 'PhotoError';
  }
}
export const PHOTO_MESSAGES: Record<PhotoFailure, string> = {
  PERMISSION_DENIED: 'Camera permission is needed for the photo. Allow it in Settings.',
  TOO_LARGE: 'That photo is too large. Take it again.',
  BAD_TYPE: 'That photo format is not supported. Take it again.',
  UNAVAILABLE: 'Could not open the camera. Try again.',
};

export interface CapturedPhoto {
  uri: string;
  contentType: (typeof PHOTO_TYPES)[number];
  /** Set once the image has been uploaded, so a retried punch does not upload it twice. */
  photoId?: string;
}

/** Pure check on what the camera returned, so the rules are testable without a device. */
export function validatePhoto(
  mime: string | undefined,
  sizeBytes: number,
): CapturedPhoto['contentType'] {
  const type = (mime ?? 'image/jpeg').toLowerCase();
  if (!(PHOTO_TYPES as readonly string[]).includes(type)) throw new PhotoError('BAD_TYPE');
  if (sizeBytes <= 0 || sizeBytes > PHOTO_MAX_BYTES) throw new PhotoError('TOO_LARGE');
  return type as CapturedPhoto['contentType'];
}

/**
 * Opens the camera once (selfie by default, or the back camera). Nothing is saved to the gallery and the
 * image is not read except to upload it with the punch. Returns null if the person cancels.
 */
export async function capturePhoto(facing: Facing): Promise<CapturedPhoto | null> {
  let perm = await ImagePicker.getCameraPermissionsAsync();
  if (!perm.granted) {
    if (!perm.canAskAgain) throw new PhotoError('PERMISSION_DENIED', false);
    perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new PhotoError('PERMISSION_DENIED', perm.canAskAgain);
  }
  let res: ImagePicker.ImagePickerResult;
  try {
    res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      cameraType: facing === 'front' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
      allowsEditing: false,
      quality: 0.5,
      exif: false,
    });
  } catch {
    throw new PhotoError('UNAVAILABLE');
  }
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const contentType = validatePhoto(a.mimeType, a.fileSize ?? 1);
  return { uri: a.uri, contentType };
}

/** Uploads straight to private storage with the short-lived signed URL the API issued. */
export async function ensureUploaded(api: ApiClient, photo: CapturedPhoto): Promise<string> {
  if (photo.photoId) return photo.photoId;
  const blob = await (await fetch(photo.uri)).blob();
  validatePhoto(photo.contentType, blob.size);
  const created = (
    await api.call({
      method: 'POST',
      path: '/attendance/photos',
      body: { contentType: photo.contentType, sizeBytes: blob.size },
      schema: photoUpload,
    })
  ).data;
  const put = await fetch(created.upload.url, {
    method: 'PUT',
    headers: created.upload.headers,
    body: blob,
  });
  if (!put.ok) throw new PhotoError('UNAVAILABLE');
  photo.photoId = created.photoId;
  return created.photoId;
}
