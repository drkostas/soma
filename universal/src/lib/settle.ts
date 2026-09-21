/**
 * Wait a little for something already in flight, then give up on it.
 *
 * The recording is uploaded the moment he stops talking, and Send is usually pressed after that has
 * landed. When it has not, this waits a beat rather than either blocking him or throwing the better
 * transcript away. Giving up is a normal answer: the phone's own words are still in the box and the
 * meal goes either way.
 */
export async function settle<T>(p: Promise<T> | null, ms: number): Promise<T | null> {
  if (!p) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const gaveUp = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    return await Promise.race([p.catch(() => null), gaveUp]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Long enough for a few hundred kilobytes on wifi, short enough not to be a wait. */
export const SETTLE_MS = 1500;
