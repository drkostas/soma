// web/lib/reccobeats-client.ts

export interface ReccoBeatsFeatures {
  id: string;       // Spotify track ID
  tempo: number;    // BPM
  energy: number;   // 0.0–1.0
  valence: number;  // 0.0–1.0
  danceability: number;
  key: number;
  mode: number;
}

async function fetchBatch(ids: string[], attempt = 0): Promise<ReccoBeatsFeatures[]> {
  if (ids.length === 0) return [];
  const url = `https://api.reccobeats.com/v1/audio-features?ids=${ids.join(",")}`;
  const res = await fetch(url, { cache: "no-store" });

  if (res.status === 429) {
    // Rate limited — wait and retry up to 2 times
    if (attempt < 2) {
      const retryAfter = parseInt(res.headers.get("Retry-After") ?? "5", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return fetchBatch(ids, attempt + 1);
    }
    console.warn("ReccoBeats rate limit hit, skipping batch");
    return [];
  }

  if (!res.ok) {
    console.warn(`ReccoBeats error: ${res.status}`);
    return [];
  }

  const data = await res.json();
  // API returns { content: [...] } — each item's href contains the Spotify track ID
  const items: Array<Record<string, unknown>> = data?.content ?? [];
  return items.map((item) => ({
    ...(item as unknown as ReccoBeatsFeatures),
    // Replace internal UUID with Spotify track ID extracted from href URL
    id: String(item.href ?? "").split("/track/")[1] ?? String(item.id),
  }));
}

/** Fetch audio features for any number of IDs, chunking into batches of 40 (ReccoBeats limit) */
export async function fetchAudioFeatures(
  ids: string[]
): Promise<Map<string, ReccoBeatsFeatures>> {
  const result = new Map<string, ReccoBeatsFeatures>();
  const BATCH_SIZE = 40; // ReccoBeats silently returns 0 results for batches >40 IDs
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const features = await fetchBatch(batch);
    for (const f of features) result.set(f.id, f);
    // Small pause between batches to avoid rate limiting
    if (i + BATCH_SIZE < ids.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return result;
}
