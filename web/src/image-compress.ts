const MAX_LONG_EDGE_PX = 1280;
const TARGET_MAX_BYTES = 1024 * 1024; // 1 MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function compressImageForUpload(file: File): Promise<File> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("僅支援 PNG、JPEG 或 WebP 格式圖片");
  }

  const bitmap = await createImageBitmap(file);
  try {
    if (file.size <= TARGET_MAX_BYTES && Math.max(bitmap.width, bitmap.height) <= MAX_LONG_EDGE_PX) {
      return file;
    }
    const scale = Math.min(1, MAX_LONG_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("瀏覽器不支援圖片壓縮");
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.85),
    );
    if (!blob) {
      throw new Error("圖片壓縮失敗");
    }
    return new File([blob], "chart.webp", { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}
