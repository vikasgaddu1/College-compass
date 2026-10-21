/** Client-side photo prep: center-crop to a square, resize to 512px, JPEG ≤ 1 MB. */
import { PHOTO_MAX_BYTES, PHOTO_SIZE } from "./constants";

export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export function checkPhotoFile(f: File): string | null {
  if (!ACCEPTED_TYPES.includes(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) return "Please choose a JPEG, PNG or WebP photo.";
  if (f.size > 25 * 1024 * 1024) return "That photo is too large (over 25 MB).";
  return null;
}

/** Square crop box (x, y, size) centered in a w×h image. */
export function squareCrop(w: number, h: number): { x: number; y: number; size: number } {
  const size = Math.min(w, h);
  return { x: Math.floor((w - size) / 2), y: Math.floor((h - size) / 2), size };
}

async function decode(file: Blob): Promise<{ draw: (ctx: CanvasRenderingContext2D, sx: number, sy: number, s: number, out: number) => void; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file);
    return { width: bmp.width, height: bmp.height, draw: (ctx, sx, sy, s, out) => ctx.drawImage(bmp, sx, sy, s, s, 0, 0, out, out), close: () => bmp.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Couldn't read that image."));
      i.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, draw: (ctx, sx, sy, s, out) => ctx.drawImage(img, sx, sy, s, s, 0, 0, out, out), close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Returns a JPEG blob, 512×512, at the highest quality that fits under 1 MB. */
export async function preparePhoto(file: Blob): Promise<Blob> {
  const src = await decode(file);
  try {
    const { x, y, size } = squareCrop(src.width, src.height);
    const canvas = document.createElement("canvas");
    canvas.width = PHOTO_SIZE;
    canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process the image.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, PHOTO_SIZE, PHOTO_SIZE);
    src.draw(ctx, x, y, size, PHOTO_SIZE);
    for (const q of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
      if (!blob) throw new Error("Couldn't encode the image.");
      if (blob.size <= PHOTO_MAX_BYTES) return blob;
    }
    throw new Error("Couldn't shrink that photo enough. Try a different one.");
  } finally {
    src.close();
  }
}
