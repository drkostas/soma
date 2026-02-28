import { NextRequest, NextResponse } from "next/server";
import { SPOTIFY_SCOPES } from "@/lib/spotify-client";

export const runtime = "edge";

async function sha256Base64url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function randomBase64url(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export async function GET(req: NextRequest) {
  const verifier = randomBase64url(64);
  const challenge = await sha256Base64url(verifier);
  const nonce = randomBase64url(16);
  const returnTo = req.nextUrl.searchParams.get("return_to") ?? "/connections";

  // Encode verifier + nonce + return_to in the state param so it survives
  // the localhost → 127.0.0.1 host hop (cookies don't cross hostnames).
  const state = btoa(JSON.stringify({ nonce, verifier, returnTo }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });

  return NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params}`
  );
}
