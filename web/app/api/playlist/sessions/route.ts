import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  selectSongsForSegment,
  qualityScore,
  pickSkipSong,
  isHalfTimeMatch,
  SongCandidate,
  SegmentConfig,
} from "@/lib/playlist-algorithm";

export const runtime = "nodejs";

interface RequestSegment {
  type: string;
  duration_s: number;
  bpm_min?: number;
  bpm_max?: number;
  bpm_tolerance?: number;
  valence_min?: number;
  valence_max?: number;
}

const BPM_DEFAULTS: Record<
  string,
  { min: number; max: number; minEnergy: number; valence_min: number; valence_max: number }
> = {
  warmup:   { min: 100, max: 140, minEnergy: 0.4,  valence_min: 0.3, valence_max: 0.7 },
  easy:     { min: 125, max: 145, minEnergy: 0.5,  valence_min: 0.3, valence_max: 0.7 },
  aerobic:  { min: 125, max: 145, minEnergy: 0.6,  valence_min: 0.3, valence_max: 0.7 },
  tempo:    { min: 160, max: 180, minEnergy: 0.75, valence_min: 0.1, valence_max: 0.5 },
  interval: { min: 175, max: 195, minEnergy: 0.85, valence_min: 0.0, valence_max: 0.4 },
  vo2max:   { min: 175, max: 195, minEnergy: 0.85, valence_min: 0.0, valence_max: 0.4 },
  recovery: { min: 125, max: 145, minEnergy: 0.5,  valence_min: 0.3, valence_max: 0.7 },
  rest:     { min: 80,  max: 110, minEnergy: 0.3,  valence_min: 0.3, valence_max: 0.7 },
  strides:  { min: 160, max: 180, minEnergy: 0.75, valence_min: 0.1, valence_max: 0.5 },
  cooldown: { min: 60,  max: 90,  minEnergy: 0.3,  valence_min: 0.6, valence_max: 1.0 },
};

export async function GET() {
  const sql = getDb();
  const rows = await sql`SELECT * FROM playlist_sessions ORDER BY created_at DESC LIMIT 50`;
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    segments = [] as RequestSegment[],
    excluded_track_ids = [] as string[],
    genre_selection = [] as string[],
    genre_threshold = 0.03,
    source_playlist_ids = [] as string[],
    workout_plan_id = null,
    garmin_activity_id = null,
  } = body;

  const sql = getDb();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (data: object) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const allAssignments: Record<number, unknown[]> = {};

      try {
        for (let idx = 0; idx < segments.length; idx++) {
          const seg = segments[idx];
          send({ type: "segment_start", index: idx });

          const defaults = BPM_DEFAULTS[seg.type] ?? BPM_DEFAULTS.easy;
          const bpmMin = seg.bpm_min ?? defaults.min;
          const bpmMax = seg.bpm_max ?? defaults.max;
          const bpmTol = seg.bpm_tolerance ?? 8;
          const valenceMin = seg.valence_min ?? defaults.valence_min;
          const valenceMax = seg.valence_max ?? defaults.valence_max;

          const lo = bpmMin - bpmTol;
          const hi = bpmMax + bpmTol;

          const cfg: SegmentConfig = {
            duration_s: seg.duration_s,
            bpm_min: bpmMin,
            bpm_max: bpmMax,
            bpm_tolerance: bpmTol,
            min_energy: defaults.minEnergy,
            valence_min: valenceMin,
            valence_max: valenceMax,
            half_time: true,
          };

          const rows = await sql`
            SELECT * FROM spotify_track_features
            WHERE (
              (tempo BETWEEN ${lo} AND ${hi})
              OR (tempo BETWEEN ${lo / 2} AND ${hi / 2})
            )
            AND energy >= ${defaults.minEnergy - 0.2}
            AND valence BETWEEN ${valenceMin} AND ${valenceMax}
            ${genre_selection.length > 0 ? sql`AND genres && ${genre_selection}` : sql``}
            ${excluded_track_ids.length > 0 ? sql`AND track_id != ALL(${excluded_track_ids})` : sql``}
            AND track_id NOT IN (SELECT track_id FROM user_blacklist)
            ORDER BY tempo
            LIMIT 500
          `;

          const alreadyPlaced = new Set(
            Object.values(allAssignments)
              .flat()
              .map((s) => (s as SongCandidate).track_id)
          );

          const candidates: SongCandidate[] = (rows as Array<Record<string, unknown>>)
            .filter((r) => !alreadyPlaced.has(r.track_id as string))
            .map((r) => ({
              track_id: r.track_id as string,
              name: r.name as string,
              artist_name: r.artist_name as string,
              artist_id: r.artist_id as string,
              duration_ms: r.duration_ms as number,
              tempo: r.tempo as number,
              energy: r.energy as number,
              valence: r.valence as number,
              quality_score: qualityScore(
                { tempo: r.tempo as number, energy: r.energy as number },
                cfg
              ),
            }));

          const poolCount = candidates.length;

          if (poolCount < 3) {
            send({
              type: "segment_warning",
              index: idx,
              message: `Only ${poolCount} songs found for this segment`,
              pool_count: poolCount,
            });
          }

          const capacity = Math.max(0, seg.duration_s - 60);
          const selected = selectSongsForSegment(candidates, capacity);

          const placedIds = new Set([
            ...alreadyPlaced,
            ...selected.map((s) => s.track_id),
          ]);
          const skipSong = pickSkipSong(candidates, placedIds);

          const segmentSongs = [
            ...selected.map((s) => ({
              ...s,
              is_skip: false,
              is_half_time: isHalfTimeMatch(s.tempo, cfg),
            })),
            ...(skipSong
              ? [{ ...skipSong, is_skip: true, is_half_time: isHalfTimeMatch(skipSong.tempo, cfg) }]
              : []),
          ];

          allAssignments[idx] = segmentSongs;
          send({ type: "segment_done", index: idx, songs: segmentSongs, pool_count: poolCount });
        }

        // Save session with all assignments at the very end (only creates a record if generation completes)
        const [sessionRecord] = await sql`
          INSERT INTO playlist_sessions
            (workout_plan_id, garmin_activity_id, source_playlist_ids, genre_selection, genre_threshold, excluded_track_ids, song_assignments)
          VALUES (
            ${workout_plan_id},
            ${garmin_activity_id},
            ${source_playlist_ids},
            ${genre_selection},
            ${genre_threshold},
            ${excluded_track_ids},
            ${JSON.stringify(allAssignments)}::jsonb
          )
          RETURNING id
        `;

        send({ type: "done", session_id: (sessionRecord as { id: number }).id });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

