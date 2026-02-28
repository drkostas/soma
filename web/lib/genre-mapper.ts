// web/lib/genre-mapper.ts

const MACRO_MAP: Record<string, string[]> = {
  "Hip-Hop": [
    "hip hop", "rap", "trap", "drill", "phonk", "dark trap",
    "melodic rap", "cloud rap", "boom bap", "crunk",
  ],
  Electronic: [
    "house", "techno", "trance", "drum and bass", "dnb", "edm",
    "dubstep", "garage", "lo-fi", "chillwave", "synthwave", "electro",
  ],
  Indie: [
    "indie pop", "indie rock", "indie folk", "alternative", "shoegaze",
    "dream pop", "bedroom pop",
  ],
  Rock: [
    "rock", "classic rock", "hard rock", "metal", "punk", "grunge",
    "post-rock", "emo",
  ],
  "R&B/Soul": ["r&b", "soul", "funk", "neo soul", "contemporary r&b"],
  "Latin/Global": [
    "reggaeton", "latin pop", "afrobeats", "afropop", "latin",
    "k-pop", "j-pop", "dancehall", "reggae",
  ],
  "Ambient/Jazz": [
    "classical", "orchestral", "jazz", "ambient", "new age",
    "meditation", "piano", "instrumental",
  ],
  Pop: ["pop", "synth-pop", "electropop", "dance pop", "art pop"],
  "Country/Folk": [
    "country", "americana", "folk", "bluegrass",
    "singer-songwriter", "acoustic",
  ],
};

/** Map an array of micro-genre strings to unique macro-genre bucket names */
export function toMacroGenres(microGenres: string[]): string[] {
  const result = new Set<string>();
  for (const micro of microGenres) {
    const lc = micro.toLowerCase();
    for (const [macro, patterns] of Object.entries(MACRO_MAP)) {
      if (patterns.some((p) => lc.includes(p))) {
        result.add(macro);
        break;
      }
    }
  }
  return Array.from(result);
}
