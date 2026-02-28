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

async function fetchBatch(ids: string[]): Promise<ReccoBeatsFeatures[]> {
  if (ids.length === 0) return [];
  const url = `https://api.reccobeats.com/v1/audio-features?ids=${ids.join(",")}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    console.warn(`ReccoBeats error: ${res.status}`);
    return [];
  }
  const data = await res.json();
  // API returns { data: { content: [...] } }
  return (data?.data?.content ?? []) as ReccoBeatsFeatures[];
}

/** Fetch audio features for any number of IDs, chunking into batches of 100 */
export async function fetchAudioFeatures(
  ids: string[]
): Promise<Map<string, ReccoBeatsFeatures>> {
  const result = new Map<string, ReccoBeatsFeatures>();
  const BATCH_SIZE = 100;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const features = await fetchBatch(batch);
    for (const f of features) result.set(f.id, f);
  }
  return result;
}
