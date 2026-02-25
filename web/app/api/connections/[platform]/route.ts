import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "edge";

const VALID_PLATFORMS = ["garmin", "hevy", "strava", "telegram", "surfr"];

// Fields each platform accepts (whitelist)
const PLATFORM_FIELDS: Record<string, string[]> = {
  hevy: ["api_key"],
  telegram: ["bot_token", "chat_id"],
  garmin: ["email", "password"],
};

// Map field keys to env var names for fallback detection
const FIELD_ENV_VARS: Record<string, Record<string, string>> = {
  garmin: { email: "GARMIN_EMAIL", password: "GARMIN_PASSWORD" },
  hevy: { api_key: "HEVY_API_KEY" },
  telegram: { bot_token: "TELEGRAM_BOT_TOKEN", chat_id: "TELEGRAM_CHAT_ID" },
};

function maskValue(val: string): string {
  if (!val || val.length <= 6) return "••••••";
  return val.slice(0, 3) + "•".repeat(Math.min(val.length - 6, 10)) + val.slice(-3);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const sql = getDb();
  const { platform } = await params;

  if (!VALID_PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  try {
    const rows = await sql`
      SELECT credentials, status FROM platform_credentials WHERE platform = ${platform}
    `;

    const creds = rows.length > 0 ? (rows[0].credentials as Record<string, string> | null) : null;
    const fields = PLATFORM_FIELDS[platform] || [];
    const envVars = FIELD_ENV_VARS[platform] || {};
    const masked: Record<string, string | null> = {};
    const sources: Record<string, "database" | "environment"> = {};
    let allFieldsSet = true;

    for (const f of fields) {
      const dbVal = creds?.[f];
      if (dbVal) {
        masked[f] = maskValue(dbVal);
        sources[f] = "database";
      } else {
        const envVar = envVars[f];
        const envVal = envVar ? process.env[envVar] : undefined;
        if (envVal) {
          masked[f] = maskValue(envVal);
          sources[f] = "environment";
        } else {
          masked[f] = null;
          allFieldsSet = false;
        }
      }
    }

    return NextResponse.json({
      configured: allFieldsSet,
      fields: masked,
      sources,
    });
  } catch (err) {
    console.error("Error fetching platform credentials:", err);
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const sql = getDb();
  const { platform } = await params;
  const allowedFields = PLATFORM_FIELDS[platform];

  if (!allowedFields) {
    return NextResponse.json({ error: "Platform does not support credential configuration" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const credentials: Record<string, string> = {};
    for (const field of allowedFields) {
      if (body[field]) {
        credentials[field] = body[field];
      }
    }

    if (Object.keys(credentials).length === 0) {
      return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });
    }

    // Merge with existing credentials (so partial updates work)
    const existing = await sql`
      SELECT credentials FROM platform_credentials WHERE platform = ${platform}
    `;
    const merged = { ...(existing[0]?.credentials as Record<string, string> || {}), ...credentials };

    await sql`
      INSERT INTO platform_credentials (platform, auth_type, credentials, status, connected_at)
      VALUES (${platform}, 'api_key', ${JSON.stringify(merged)}::jsonb, 'active', NOW())
      ON CONFLICT (platform)
      DO UPDATE SET credentials = ${JSON.stringify(merged)}::jsonb,
                    status = 'active',
                    connected_at = NOW()
    `;

    return NextResponse.json({ saved: true, platform });
  } catch (err) {
    console.error("Error saving platform credentials:", err);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const sql = getDb();
  const { platform } = await params;

  if (!VALID_PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  try {
    const rows = await sql`
      UPDATE platform_credentials
      SET status = 'disconnected', credentials = '{}'::jsonb
      WHERE platform = ${platform}
      RETURNING platform
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Platform not found" }, { status: 404 });
    }

    return NextResponse.json({ disconnected: true, platform });
  } catch (err) {
    console.error("Error disconnecting platform:", err);
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 });
  }
}
