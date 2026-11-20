export const MAX_UPLOAD_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

export type SupportedImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface ValidatedUploadImage {
  readonly mimeType: SupportedImageMime;
  readonly bytes: Uint8Array;
}

export class ImageValidationError extends Error {
  readonly statusCode: 400 | 413;

  constructor(message: string, statusCode: 400 | 413 = 400) {
    super(message);
    this.name = "ImageValidationError";
    this.statusCode = statusCode;
  }
}

export function detectImageMimeFromMagicBytes(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // WebP: RIFF....WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

export function validateUploadImageBytes(bytes: Uint8Array): ValidatedUploadImage {
  if (bytes.byteLength === 0) {
    throw new ImageValidationError("上傳圖片不可為空", 400);
  }
  if (bytes.byteLength > MAX_UPLOAD_IMAGE_BYTES) {
    throw new ImageValidationError("上傳圖片超過 2 MB 上限", 413);
  }
  const mimeType = detectImageMimeFromMagicBytes(bytes);
  if (!mimeType) {
    throw new ImageValidationError("僅支援 PNG、JPEG 或 WebP 圖片格式", 400);
  }
  return { mimeType, bytes };
}
