import { useState } from "react";
import { View, TextInput } from "react-native";
import { Text, Modal, Button } from "soma-style";
import { connectPlatform } from "../lib/api";

interface Field { key: string; label: string; secure?: boolean; placeholder: string }
const FIELDS: Record<string, Field[] | null> = {
  hevy: [{ key: "api_key", label: "Hevy API key", secure: true, placeholder: "hevy_xxx…" }],
  telegram: [
    { key: "bot_token", label: "Bot token", secure: true, placeholder: "123456:ABC-DEF…" },
    { key: "chat_id", label: "Chat ID", placeholder: "123456789" },
  ],
  garmin: null, // browser-auth ticket flow → web dashboard
  strava: null, // OAuth → web dashboard
  surfr: null,
};
const LABEL: Record<string, string> = {
  garmin: "Garmin Connect", strava: "Strava", hevy: "Hevy", telegram: "Telegram", surfr: "Surfr",
};

/**
 * Credentials dialog for connecting a platform (web parity, #443). Hevy (API
 * key) and Telegram (bot + chat) are simple keys entered here and POSTed to
 * /api/connections/[platform]. Garmin (browser-auth ticket) and Strava (OAuth)
 * use flows better suited to the web dashboard — those are a documented trim.
 * The user types their own credentials; secure fields are masked.
 */
export function CredentialsDialog({ platform, onClose, onSaved }: { platform: string | null; onClose: () => void; onSaved?: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!platform) return null;
  const fields = FIELDS[platform];
  const set = (k: string, v: string) => setValues((m) => ({ ...m, [k]: v }));

  async function save() {
    if (!platform || !fields) return;
    setSaving(true); setErr(null);
    const ok = await connectPlatform(platform, values);
    setSaving(false);
    if (ok) { setValues({}); onSaved?.(); onClose(); }
    else setErr("Could not connect — check the values and try again.");
  }

  return (
    <Modal visible={!!platform} onClose={onClose} title={`Connect ${LABEL[platform] ?? platform}`}>
      <View className="gap-3">
        {fields ? (
          <>
            {fields.map((f) => (
              <View key={f.key} className="gap-1">
                <Text variant="micro" className="text-text-muted">{f.label}</Text>
                <TextInput
                  value={values[f.key] ?? ""}
                  onChangeText={(t) => set(f.key, t)}
                  placeholder={f.placeholder}
                  placeholderTextColor="#5a7a8a"
                  secureTextEntry={f.secure}
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="rounded-lg bg-surface-subtle px-3 py-2"
                  style={{ color: "#e6edf0" }}
                />
              </View>
            ))}
            {err ? <Text variant="micro" className="text-danger">{err}</Text> : null}
            <Button variant="primary" onPress={save} disabled={saving} label={saving ? "Connecting…" : "Connect"} />
            <Text variant="micro" className="text-text-muted">Your credentials are sent directly to your soma instance.</Text>
          </>
        ) : (
          <>
            <Text variant="body" className="text-text-secondary">
              {LABEL[platform] ?? platform} uses a {platform === "strava" ? "one-tap OAuth" : "browser-based"} sign-in that's handled on the soma web dashboard.
            </Text>
            <Text variant="micro" className="text-text-muted">Open soma on the web to connect {LABEL[platform] ?? platform}, then pull-to-refresh here.</Text>
          </>
        )}
      </View>
    </Modal>
  );
}
