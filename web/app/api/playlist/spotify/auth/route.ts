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

export async function GET(_req: NextRequest) {
  const verifier = randomBase64url(64);
  const challenge = await sha256Base64url(verifier);
  const state = randomBase64url(16);

  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri: process.env.SPOTIFY_REDIRECT_URI!,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });

  const res = NextResponse.redirect(
    `https://accounts.spotify.com/authorize?${params}`
  );

  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  };
  res.cookies.set("spotify_pkce_verifier", verifier, cookieOpts);
  res.cookies.set("spotify_state", state, cookieOpts);
  return res;
}
