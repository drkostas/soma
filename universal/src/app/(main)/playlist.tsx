import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { Text, Card, Badge, ProgressBar, SegmentedControl, Button } from "soma-style";
import { router } from "expo-router";
import { fetchJson } from "../../lib/api";

/** Library analysis status — how much of the Spotify library has BPM data. */
interface LibraryStatus {
  total_tracks: number | string;
  tracks_with_bpm: number | string;
  last_synced: string | null;
}

/** A saved playlist-builder session (a generated, BPM-matched run playlist). */
interface PlaylistSession {
  id: number;
  workout_name: string | null;
  garmin_activity_id: string | null;
  spotify_playlist_url: string | null;
  song_assignments: Record<string, unknown[]> | null;
  created_at: string;
}

/** A reusable workout plan (segment template) used to build a playlist. */
interface WorkoutPlan {
  id: number;
  name: string;
  sport_type: string | null;
  total_duration_s: number | null;
  source: string | null;
  created_at: string;
}

interface PlaylistData {
  library: LibraryStatus | null;
  sessions: PlaylistSession[];
  plans: WorkoutPlan[];
}

/** Fetches the three GET surfaces the playlist page reads from soma (:3456). */
function usePlaylist() {
  const [data, setData] = useState<PlaylistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    const json = (path: string) => fetchJson<unknown>(path);

    Promise.all([
      json("/api/playlist/spotify/library"),
      json("/api/playlist/sessions"),
      json("/api/playlist/workout-plans"),
    ])
      .then(([library, sessions, plans]) => {
        if (!alive) return;
        setData({
          library: (library as LibraryStatus) ?? null,
          sessions: (sessions as PlaylistSession[]) ?? [],
          plans: (plans as WorkoutPlan[]) ?? [],
        });
        setError(null);
      })
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));

    return () => {
      alive = false;
    };
  }, []);

  return { data, loading, error };
}

const toNum = (v: number | string | null | undefined) =>
  v == null ? 0 : typeof v === "number" ? v : Number(v) || 0;

function fmtDuration(sec: number | null): string {
  if (!sec) return "—";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${(m / 60).toFixed(1)} h`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

function trackCount(assignments: Record<string, unknown[]> | null): number {
  if (!assignments) return 0;
  return Object.values(assignments).reduce(
    (sum, songs) => sum + (Array.isArray(songs) ? songs.length : 0),
    0,
  );
}

export default function PlaylistScreen() {
  const { data, loading, error } = usePlaylist();
  const [tab, setTab] = useState<"Playlists" | "Plans">("Playlists");

  const lib = data?.library;
  const total = toNum(lib?.total_tracks);
  const withBpm = toNum(lib?.tracks_with_bpm);
  const analysed = total > 0;
  const bpmPct = total > 0 ? withBpm / total : 0;

  // Drop empty drafts (no songs, not on Spotify) and collapse same-day sessions
  // that share a workout name — the DB has dozens of null-named "Run" sessions,
  // several on the same day, which rendered as a wall of near-identical cards.
  // Within a (name, day) group keep the best one (on Spotify wins, else most
  // songs) and surface a ×N count.
  const sessions = (() => {
    const real = (data?.sessions ?? []).filter(
      (s) => trackCount(s.song_assignments) > 0 || s.spotify_playlist_url,
    );
    const groups = new Map<string, { best: PlaylistSession; count: number }>();
    for (const s of real) {
      const key = `${s.workout_name ?? "Run"}|${(s.created_at ?? "").slice(0, 10)}`;
      const g = groups.get(key);
      if (!g) {
        groups.set(key, { best: s, count: 1 });
        continue;
      }
      g.count += 1;
      const better =
        (!!s.spotify_playlist_url && !g.best.spotify_playlist_url) ||
        trackCount(s.song_assignments) > trackCount(g.best.song_assignments);
      if (better) g.best = s;
    }
    return [...groups.values()].sort(
      (a, b) => new Date(b.best.created_at ?? 0).getTime() - new Date(a.best.created_at ?? 0).getTime(),
    );
  })();
  const plans = data?.plans ?? [];

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6">
      <View className="w-full max-w-2xl gap-4">
        <View className="flex-row items-center gap-2">
          <Text variant="headline">Playlist</Text>
          {lib ? (
            <Badge
              label={analysed ? "Library ready" : "Not analysed"}
              tone={analysed ? "success" : "warm"}
            />
          ) : null}
        </View>
        <Text variant="caption" className="text-text-secondary">
          BPM-matched running playlists from your Spotify library
        </Text>

        {error ? (
          <Card>
            <Text variant="body" className="text-danger">
              API: {error} — is soma running on :3456?
            </Text>
          </Card>
        ) : null}

        {loading && !data ? (
          <Card>
            <Text variant="body" className="text-text-secondary">
              Loading playlist library…
            </Text>
          </Card>
        ) : null}

        {/* Data-dependent content — hidden during the initial load so the 0-value
            Library card never flashes as if it were real empty data. */}
        {data ? (
        <>
        {/* Library analysis status — the onboarding "analyse library" surface */}
        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Library</Text>
            <Text variant="micro" className="tabular-nums">
              {lib?.last_synced ? `synced ${fmtDate(lib.last_synced)}` : "never synced"}
            </Text>
          </View>
          <View className="flex-row gap-3">
            <View className="flex-1 gap-1">
              <Text variant="headline" className="text-teal tabular-nums">
                {total.toLocaleString()}
              </Text>
              <Text variant="micro">tracks in library</Text>
            </View>
            <View className="flex-1 gap-1">
              <Text variant="headline" className="text-lime tabular-nums">
                {withBpm.toLocaleString()}
              </Text>
              <Text variant="micro">with BPM data</Text>
            </View>
          </View>
          <View className="gap-1">
            <View className="flex-row justify-between">
              <Text variant="caption" className="text-text-secondary">
                BPM coverage
              </Text>
              <Text variant="caption" className="tabular-nums text-text">
                {Math.round(bpmPct * 100)}%
              </Text>
            </View>
            <ProgressBar pct={bpmPct} color="#6ad4a0" />
          </View>
          <Text variant="micro">
            {analysed
              ? "Library analysed — build a run playlist from any Garmin run or saved plan."
              : "Connect Spotify and analyse your library on the web app to enable playlist building."}
          </Text>
        </Card>

        <Button
          label="Build a new playlist"
          variant="primary"
          disabled={!analysed}
          onPress={() => router.push("/playlist-builder")}
        />

        <SegmentedControl
          options={["Playlists", "Plans"] as const}
          value={tab}
          onChange={setTab}
        />

        {/* Saved playlist sessions */}
        {tab === "Playlists" ? (
          sessions.length ? (
            sessions.map(({ best: s, count: dupes }) => {
              const count = trackCount(s.song_assignments);
              return (
                <Card key={s.id} className="gap-2">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 flex-row items-center gap-2 pr-2">
                      <Text variant="body" className="text-text">
                        {s.workout_name ?? "Run"}
                      </Text>
                      {dupes > 1 ? (
                        <Text variant="micro" className="text-text-muted">
                          ×{dupes}
                        </Text>
                      ) : null}
                    </View>
                    {s.spotify_playlist_url ? (
                      <Badge label="On Spotify" tone="success" />
                    ) : (
                      <Badge label="Draft" tone="neutral" />
                    )}
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Text variant="micro" className="tabular-nums">
                      {count} {count === 1 ? "song" : "songs"}
                    </Text>
                    <Text variant="micro" className="tabular-nums">
                      {fmtDate(s.created_at)}
                    </Text>
                  </View>
                </Card>
              );
            })
          ) : (
            <Card>
              <Text variant="micro">
                No saved playlists yet. Generate one on the web playlist builder.
              </Text>
            </Card>
          )
        ) : null}

        {/* Reusable workout plans (segment templates) */}
        {tab === "Plans" ? (
          plans.length ? (
            plans.map((p) => (
              <Card key={p.id} className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text variant="body" className="text-text">
                    {p.name}
                  </Text>
                  {p.source ? <Badge label={p.source} tone="teal" /> : null}
                </View>
                <View className="flex-row items-center justify-between">
                  <Text variant="micro" className="uppercase">
                    {p.sport_type ?? "running"}
                  </Text>
                  <Text variant="micro" className="tabular-nums">
                    {fmtDuration(p.total_duration_s)} · {fmtDate(p.created_at)}
                  </Text>
                </View>
              </Card>
            ))
          ) : (
            <Card>
              <Text variant="micro">
                No workout plans saved yet. Build one in the playlist timeline.
              </Text>
            </Card>
          )
        ) : null}
        </>
        ) : null}
      </View>
    </ScrollView>
  );
}
