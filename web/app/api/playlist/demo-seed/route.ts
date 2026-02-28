// web/app/api/playlist/demo-seed/route.ts
// Dev-only endpoint: seeds demo tracks covering all BPM ranges so the UI is testable
// without a real Spotify library. All track_ids start with "demo_".
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// 80 demo tracks spanning 60–200 BPM with realistic metadata
const DEMO_TRACKS = [
  // --- COOLDOWN: 60–90 BPM, high valence, low energy ---
  { id: "demo_cool_1", name: "Easy Like Sunday Morning", artist: "Lionel Richie", artist_id: "demo_a1", bpm: 63, energy: 0.38, valence: 0.82, dur: 246000, genres: ["Pop", "R&B/Soul"] },
  { id: "demo_cool_2", name: "Landslide", artist: "Fleetwood Mac", artist_id: "demo_a2", bpm: 68, energy: 0.32, valence: 0.71, dur: 199000, genres: ["Rock", "Indie"] },
  { id: "demo_cool_3", name: "Fast Car", artist: "Tracy Chapman", artist_id: "demo_a3", bpm: 74, energy: 0.40, valence: 0.65, dur: 296000, genres: ["Country/Folk"] },
  { id: "demo_cool_4", name: "Holocene", artist: "Bon Iver", artist_id: "demo_a4", bpm: 78, energy: 0.28, valence: 0.59, dur: 366000, genres: ["Indie"] },
  { id: "demo_cool_5", name: "Golden Hour", artist: "JVKE", artist_id: "demo_a5", bpm: 82, energy: 0.45, valence: 0.88, dur: 209000, genres: ["Pop"] },
  { id: "demo_cool_6", name: "Die With A Smile", artist: "Bruno Mars", artist_id: "demo_a6", bpm: 85, energy: 0.50, valence: 0.79, dur: 255000, genres: ["Pop", "R&B/Soul"] },
  { id: "demo_cool_7", name: "Yellow", artist: "Coldplay", artist_id: "demo_a7", bpm: 87, energy: 0.41, valence: 0.68, dur: 268000, genres: ["Rock", "Indie"] },

  // --- REST: 80–110 BPM, moderate valence ---
  { id: "demo_rest_1", name: "Stay With Me", artist: "Sam Smith", artist_id: "demo_a8", bpm: 84, energy: 0.48, valence: 0.44, dur: 172000, genres: ["Pop", "R&B/Soul"] },
  { id: "demo_rest_2", name: "Shape of You", artist: "Ed Sheeran", artist_id: "demo_a9", bpm: 96, energy: 0.65, valence: 0.74, dur: 234000, genres: ["Pop"] },
  { id: "demo_rest_3", name: "Blinding Lights", artist: "The Weeknd", artist_id: "demo_a10", bpm: 92, energy: 0.73, valence: 0.61, dur: 200000, genres: ["Pop", "Electronic"] },
  { id: "demo_rest_4", name: "Flowers", artist: "Miley Cyrus", artist_id: "demo_a11", bpm: 110, energy: 0.62, valence: 0.80, dur: 200000, genres: ["Pop"] },
  { id: "demo_rest_5", name: "Anti-Hero", artist: "Taylor Swift", artist_id: "demo_a12", bpm: 97, energy: 0.60, valence: 0.55, dur: 200000, genres: ["Pop", "Indie"] },

  // --- WARMUP: 100–140 BPM, moderate energy 0.4+ ---
  { id: "demo_warm_1", name: "Levitating", artist: "Dua Lipa", artist_id: "demo_a13", bpm: 103, energy: 0.66, valence: 0.72, dur: 203000, genres: ["Pop", "Electronic"] },
  { id: "demo_warm_2", name: "Uptown Funk", artist: "Bruno Mars", artist_id: "demo_a6", bpm: 115, energy: 0.78, valence: 0.85, dur: 270000, genres: ["Pop", "R&B/Soul"] },
  { id: "demo_warm_3", name: "Can't Stop the Feeling", artist: "Justin Timberlake", artist_id: "demo_a14", bpm: 113, energy: 0.71, valence: 0.91, dur: 236000, genres: ["Pop"] },
  { id: "demo_warm_4", name: "Shake It Off", artist: "Taylor Swift", artist_id: "demo_a12", bpm: 160, energy: 0.72, valence: 0.87, dur: 219000, genres: ["Pop", "Indie"] },
  { id: "demo_warm_5", name: "Happy", artist: "Pharrell Williams", artist_id: "demo_a15", bpm: 160, energy: 0.70, valence: 0.93, dur: 233000, genres: ["Pop", "R&B/Soul"] },
  { id: "demo_warm_6", name: "Moves Like Jagger", artist: "Maroon 5", artist_id: "demo_a16", bpm: 128, energy: 0.67, valence: 0.78, dur: 200000, genres: ["Pop", "Rock"] },
  { id: "demo_warm_7", name: "Dynamite", artist: "BTS", artist_id: "demo_a17", bpm: 114, energy: 0.74, valence: 0.87, dur: 199000, genres: ["Pop", "Electronic"] },
  { id: "demo_warm_8", name: "Good 4 U", artist: "Olivia Rodrigo", artist_id: "demo_a18", bpm: 166, energy: 0.66, valence: 0.66, dur: 178000, genres: ["Pop", "Rock", "Indie"] },

  // --- EASY / AEROBIC / RECOVERY: 125–145 BPM, energy 0.5+ ---
  { id: "demo_easy_1", name: "Cruel Summer", artist: "Taylor Swift", artist_id: "demo_a12", bpm: 170, energy: 0.70, valence: 0.56, dur: 178000, genres: ["Pop", "Indie"] },
  { id: "demo_easy_2", name: "As It Was", artist: "Harry Styles", artist_id: "demo_a19", bpm: 174, energy: 0.73, valence: 0.64, dur: 167000, genres: ["Pop", "Indie"] },
  { id: "demo_easy_3", name: "About Damn Time", artist: "Lizzo", artist_id: "demo_a20", bpm: 110, energy: 0.77, valence: 0.90, dur: 193000, genres: ["Pop", "R&B/Soul"] },
  { id: "demo_easy_4", name: "Peaches", artist: "Justin Bieber", artist_id: "demo_a21", bpm: 90, energy: 0.55, valence: 0.76, dur: 198000, genres: ["Pop", "R&B/Soul"] },
  { id: "demo_easy_5", name: "Bad Guy", artist: "Billie Eilish", artist_id: "demo_a22", bpm: 135, energy: 0.64, valence: 0.55, dur: 194000, genres: ["Pop", "Indie"] },
  { id: "demo_easy_6", name: "Watermelon Sugar", artist: "Harry Styles", artist_id: "demo_a19", bpm: 95, energy: 0.61, valence: 0.71, dur: 174000, genres: ["Pop", "Rock"] },
  { id: "demo_easy_7", name: "Blueberry Faygo", artist: "Lil Mosey", artist_id: "demo_a23", bpm: 130, energy: 0.62, valence: 0.55, dur: 166000, genres: ["Hip-Hop"] },
  { id: "demo_easy_8", name: "Rockstar", artist: "Post Malone", artist_id: "demo_a24", bpm: 160, energy: 0.55, valence: 0.22, dur: 218000, genres: ["Hip-Hop", "Rock"] },

  // --- TEMPO / STRIDES: 160–180 BPM, energy 0.75+, dark valence ---
  { id: "demo_tempo_1", name: "HUMBLE.", artist: "Kendrick Lamar", artist_id: "demo_a25", bpm: 150, energy: 0.77, valence: 0.36, dur: 177000, genres: ["Hip-Hop"] },
  { id: "demo_tempo_2", name: "God's Plan", artist: "Drake", artist_id: "demo_a26", bpm: 77, energy: 0.44, valence: 0.41, dur: 198000, genres: ["Hip-Hop"] },
  { id: "demo_tempo_3", name: "SICKO MODE", artist: "Travis Scott", artist_id: "demo_a27", bpm: 155, energy: 0.82, valence: 0.31, dur: 312000, genres: ["Hip-Hop"] },
  { id: "demo_tempo_4", name: "Goosebumps", artist: "Travis Scott", artist_id: "demo_a27", bpm: 130, energy: 0.79, valence: 0.19, dur: 243000, genres: ["Hip-Hop"] },
  { id: "demo_tempo_5", name: "Money Trees", artist: "Kendrick Lamar", artist_id: "demo_a25", bpm: 131, energy: 0.78, valence: 0.42, dur: 386000, genres: ["Hip-Hop"] },
  { id: "demo_tempo_6", name: "Stronger", artist: "Kanye West", artist_id: "demo_a28", bpm: 104, energy: 0.76, valence: 0.35, dur: 312000, genres: ["Hip-Hop", "Electronic"] },
  { id: "demo_tempo_7", name: "Lose Yourself", artist: "Eminem", artist_id: "demo_a29", bpm: 171, energy: 0.81, valence: 0.26, dur: 326000, genres: ["Hip-Hop"] },
  { id: "demo_tempo_8", name: "Till I Collapse", artist: "Eminem", artist_id: "demo_a29", bpm: 171, energy: 0.84, valence: 0.31, dur: 298000, genres: ["Hip-Hop"] },
  { id: "demo_tempo_9", name: "Don't Stop Me Now", artist: "Queen", artist_id: "demo_a30", bpm: 156, energy: 0.86, valence: 0.88, dur: 210000, genres: ["Rock"] },
  { id: "demo_tempo_10", name: "Eye of the Tiger", artist: "Survivor", artist_id: "demo_a31", bpm: 109, energy: 0.85, valence: 0.55, dur: 245000, genres: ["Rock"] },
  { id: "demo_tempo_11", name: "Thunderstruck", artist: "AC/DC", artist_id: "demo_a32", bpm: 134, energy: 0.92, valence: 0.44, dur: 292000, genres: ["Rock"] },
  { id: "demo_tempo_12", name: "Welcome to the Jungle", artist: "Guns N' Roses", artist_id: "demo_a33", bpm: 122, energy: 0.91, valence: 0.38, dur: 272000, genres: ["Rock"] },

  // --- INTERVAL / VO2MAX: 175–195 BPM, energy 0.85+, very dark ---
  { id: "demo_int_1", name: "Pump It", artist: "Black Eyed Peas", artist_id: "demo_a34", bpm: 145, energy: 0.87, valence: 0.33, dur: 214000, genres: ["Hip-Hop", "Electronic"] },
  { id: "demo_int_2", name: "Jump Around", artist: "House of Pain", artist_id: "demo_a35", bpm: 167, energy: 0.89, valence: 0.65, dur: 238000, genres: ["Hip-Hop"] },
  { id: "demo_int_3", name: "Can't Hold Us", artist: "Macklemore", artist_id: "demo_a36", bpm: 146, energy: 0.86, valence: 0.69, dur: 258000, genres: ["Hip-Hop"] },
  { id: "demo_int_4", name: "Power", artist: "Kanye West", artist_id: "demo_a28", bpm: 88, energy: 0.88, valence: 0.24, dur: 291000, genres: ["Hip-Hop", "Electronic"] },
  { id: "demo_int_5", name: "Numb/Encore", artist: "Linkin Park", artist_id: "demo_a37", bpm: 105, energy: 0.90, valence: 0.26, dur: 261000, genres: ["Rock"] },
  { id: "demo_int_6", name: "In The End", artist: "Linkin Park", artist_id: "demo_a37", bpm: 105, energy: 0.88, valence: 0.28, dur: 216000, genres: ["Rock"] },
  { id: "demo_int_7", name: "Run The World", artist: "Beyoncé", artist_id: "demo_a38", bpm: 130, energy: 0.88, valence: 0.57, dur: 236000, genres: ["Pop", "Electronic"] },
  { id: "demo_int_8", name: "Yoncé", artist: "Beyoncé", artist_id: "demo_a38", bpm: 130, energy: 0.89, valence: 0.42, dur: 162000, genres: ["Hip-Hop", "R&B/Soul"] },
  { id: "demo_int_9", name: "Smells Like Teen Spirit", artist: "Nirvana", artist_id: "demo_a39", bpm: 117, energy: 0.92, valence: 0.36, dur: 301000, genres: ["Rock"] },
  { id: "demo_int_10", name: "Enter Sandman", artist: "Metallica", artist_id: "demo_a40", bpm: 123, energy: 0.93, valence: 0.21, dur: 332000, genres: ["Rock"] },
  { id: "demo_int_11", name: "Master of Puppets", artist: "Metallica", artist_id: "demo_a40", bpm: 107, energy: 0.94, valence: 0.18, dur: 515000, genres: ["Rock"] },
  { id: "demo_int_12", name: "Killing In The Name", artist: "Rage Against the Machine", artist_id: "demo_a41", bpm: 105, energy: 0.95, valence: 0.17, dur: 313000, genres: ["Rock"] },

  // --- ELECTRONIC: various BPMs ---
  { id: "demo_edm_1", name: "Animals", artist: "Martin Garrix", artist_id: "demo_a42", bpm: 128, energy: 0.91, valence: 0.39, dur: 204000, genres: ["Electronic"] },
  { id: "demo_edm_2", name: "Titanium", artist: "David Guetta", artist_id: "demo_a43", bpm: 126, energy: 0.79, valence: 0.43, dur: 245000, genres: ["Electronic", "Pop"] },
  { id: "demo_edm_3", name: "Levels", artist: "Avicii", artist_id: "demo_a44", bpm: 126, energy: 0.80, valence: 0.72, dur: 203000, genres: ["Electronic"] },
  { id: "demo_edm_4", name: "Wake Me Up", artist: "Avicii", artist_id: "demo_a44", bpm: 124, energy: 0.75, valence: 0.77, dur: 247000, genres: ["Electronic", "Country/Folk"] },
  { id: "demo_edm_5", name: "Clarity", artist: "Zedd", artist_id: "demo_a45", bpm: 128, energy: 0.82, valence: 0.52, dur: 268000, genres: ["Electronic", "Pop"] },
  { id: "demo_edm_6", name: "Scary Monsters", artist: "Skrillex", artist_id: "demo_a46", bpm: 140, energy: 0.93, valence: 0.27, dur: 262000, genres: ["Electronic"] },
  { id: "demo_edm_7", name: "Bangarang", artist: "Skrillex", artist_id: "demo_a46", bpm: 110, energy: 0.92, valence: 0.37, dur: 214000, genres: ["Electronic"] },
  { id: "demo_edm_8", name: "Ghost", artist: "Daft Punk", artist_id: "demo_a47", bpm: 100, energy: 0.77, valence: 0.54, dur: 325000, genres: ["Electronic"] },
  { id: "demo_edm_9", name: "Around the World", artist: "Daft Punk", artist_id: "demo_a47", bpm: 121, energy: 0.80, valence: 0.63, dur: 428000, genres: ["Electronic"] },
  { id: "demo_edm_10", name: "Get Lucky", artist: "Daft Punk", artist_id: "demo_a47", bpm: 116, energy: 0.74, valence: 0.80, dur: 369000, genres: ["Electronic", "R&B/Soul"] },
];

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const sql = getDb();

  // Delete any existing demo tracks
  await sql`DELETE FROM spotify_track_features WHERE track_id LIKE 'demo_%'`;

  // Insert demo tracks
  for (const t of DEMO_TRACKS) {
    await sql`
      INSERT INTO spotify_track_features
        (track_id, name, artist_id, artist_name, duration_ms, tempo, energy, valence, genres, raw_genres, cached_at)
      VALUES (
        ${t.id}, ${t.name}, ${t.artist_id}, ${t.artist},
        ${t.dur}, ${t.bpm}, ${t.energy}, ${t.valence},
        ${t.genres}, ${t.genres},
        NOW()
      )
      ON CONFLICT (track_id) DO UPDATE SET
        name = EXCLUDED.name, tempo = EXCLUDED.tempo, energy = EXCLUDED.energy,
        valence = EXCLUDED.valence, genres = EXCLUDED.genres
    `;
  }

  return NextResponse.json({ inserted: DEMO_TRACKS.length, message: `Seeded ${DEMO_TRACKS.length} demo tracks` });
}

export async function DELETE() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const sql = getDb();
  const result = await sql`DELETE FROM spotify_track_features WHERE track_id LIKE 'demo_%' RETURNING track_id`;
  return NextResponse.json({ deleted: result.length });
}
