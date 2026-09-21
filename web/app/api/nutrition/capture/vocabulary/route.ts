/** The food words to expect, for the recogniser on the phone. Read-only. */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getVocabulary } from "@/lib/capture-vocabulary";

export async function GET() {
  return NextResponse.json({ words: await getVocabulary(getDb()) });
}
