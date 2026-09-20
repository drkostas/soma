/**
 * A meal photo, made small enough to be worth storing.
 *
 * ⛔ A FULL-RESOLUTION PHOTO SHOULD NEVER HAVE BEEN SENT. The agent needs to see the plate, not
 * count the pixels, and the bytes travel a long way to reach it: the phone posts to Vercel, Vercel
 * inserts them through the db gateway, and the Neon HTTP driver sends a Buffer as a hex string, so
 * the request is a little over twice the photo. The gateway refused a real photo outright with
 * 413 "body too large", and the owner saw "The upload failed (500)".
 *
 * Resizing the long side to 1280 takes a phone photo to a few hundred kilobytes, which the agent
 * reads just as well, and makes the whole chain comfortable rather than marginal.
 *
 * The size is the only thing decided here, so it is the only thing that needs testing.
 */
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/** The long side, in pixels. Enough for a vision model to read a plate. */
export const MAX_EDGE = 1280;
/** JPEG quality. Food is forgiving, and this halves the bytes again. */
export const QUALITY = 0.7;

/** The resize action for an image of this shape, or null when it is already small enough. */
export function resizeFor(width: number, height: number, maxEdge = MAX_EDGE): { width: number } | { height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (Math.max(width, height) <= maxEdge) return null;
  // Constrain the long side and let the library keep the aspect ratio.
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}

/**
 * A smaller copy of the picked photo, or the original uri when it cannot be resized.
 *
 * Never throws: a photo that will not shrink is still worth trying to send, and the size check on
 * the way out will refuse it with a reason if it is hopeless.
 */
export async function shrinkPhoto(uri: string, width?: number, height?: number): Promise<string> {
  try {
    const action = width != null && height != null ? resizeFor(width, height) : { width: MAX_EDGE };
    if (!action) return uri;
    const ctx = ImageManipulator.manipulate(uri).resize(action);
    const image = await ctx.renderAsync();
    const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: QUALITY });
    return out.uri || uri;
  } catch {
    return uri;
  }
}
