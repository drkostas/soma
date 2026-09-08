import { useState } from "react";
import { ScrollView, View, TextInput, Pressable } from "react-native";
import { Text, Card, Badge, Button } from "soma-style";
import { API_BASE, DEFAULT_API_BASE, AUTH_SOURCE, AUTH_HEADERS, EMBEDDED_TOKEN, applyAuth, hostOf, type AuthSource } from "../../lib/api";
import { saveStoredAuth, clearStoredAuth } from "../../lib/auth-store";

const SOURCE_LABEL: Record<AuthSource, string> = {
  embedded: "Embedded build token",
  stored: "Stored on this device",
  none: "No token",
};

/**
 * Sign-in for installs without the embedded token build (soma#796): an API base URL and a bearer
 * token, kept in the device keychain / keystore. The embedded-token flow is untouched: with nothing
 * stored, the app keeps using EXPO_PUBLIC_API_URL and EXPO_PUBLIC_API_TOKEN, and "Use the build's
 * token" returns to it. Web's equivalent is the GitHub sign-in on soma.gkos.dev; the personal API
 * token is what this native client uses instead of a session.
 */
export default function LoginScreen() {
  const [url, setUrl] = useState(API_BASE);
  const [token, setToken] = useState("");
  const [source, setSource] = useState<AuthSource>(AUTH_SOURCE);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const base = url.trim().replace(/\/+$/, "");
  const validUrl = /^https?:\/\/[^\s/]+/.test(base);

  async function testConnection() {
    if (!validUrl) { setResult({ ok: false, text: "Enter a URL that starts with http:// or https://" }); return; }
    setTesting(true); setResult(null);
    const headers: Record<string, string> = token.trim()
      ? { Authorization: `Bearer ${token.trim()}` }
      : { ...AUTH_HEADERS };
    try {
      // soma's API answers a rejected or missing token with a redirect to the login page, which
      // fetch follows: a real answer is JSON, the login page is HTML.
      const res = await fetch(`${base}/api/health/today`, { headers });
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && type.includes("json")) {
        setResult({ ok: true, text: `Connected. ${hostOf(base)} answered with today's health${token.trim() ? " for the token you entered" : ""}.` });
      } else if (res.status === 401 || res.status === 403 || type.includes("html")) {
        const why = type.includes("html") ? "it answered with the sign-in page" : `HTTP ${res.status}`;
        setResult({ ok: false, text: `Rejected. ${hostOf(base)} did not accept ${token.trim() ? "that token" : "the current token"} (${why}).` });
      } else {
        setResult({ ok: false, text: `Unexpected reply from ${hostOf(base)} (HTTP ${res.status}).` });
      }
    } catch {
      setResult({ ok: false, text: `Unreachable. Could not reach ${hostOf(base)} from this device.` });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    if (!validUrl) { setNote("Enter a valid URL first."); return; }
    if (!token.trim() && source !== "embedded") { setNote("Enter the personal API token from Settings on the web dashboard."); return; }
    try {
      await saveStoredAuth({ baseUrl: base, token: token.trim() });
      applyAuth(base, token.trim() || null, token.trim() ? "stored" : source);
      setSource(token.trim() ? "stored" : source);
      setToken("");
      setNote(`Saved. Screens now use ${hostOf(base)}.`);
    } catch {
      setNote("Couldn't store the credentials on this device.");
    }
  }

  async function useBuildToken() {
    try {
      await clearStoredAuth();
      applyAuth(DEFAULT_API_BASE, null, EMBEDDED_TOKEN ? "embedded" : "none");
      setSource(EMBEDDED_TOKEN ? "embedded" : "none");
      setUrl(DEFAULT_API_BASE);
      setToken("");
      setResult(null);
      setNote(EMBEDDED_TOKEN ? "Back to the build's embedded token." : "Stored credentials removed.");
    } catch {
      setNote("Couldn't clear the stored credentials.");
    }
  }

  return (
    <ScrollView className="flex-1 bg-base" contentContainerClassName="items-center px-5 py-6" keyboardShouldPersistTaps="handled">
      <View className="w-full max-w-2xl gap-4">
        <View className="gap-1">
          <Text variant="headline">Sign in</Text>
          <Text variant="caption" className="text-text-secondary">
            Point the app at your soma server with a personal API token
          </Text>
        </View>

        <Card className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="eyebrow">Current access</Text>
            <View testID="login-source">
              <Badge label={SOURCE_LABEL[source]} tone={source === "none" ? "neutral" : "success"} />
            </View>
          </View>
          <Text variant="micro" className="text-text-muted" testID="login-current-host">
            Server: {hostOf(API_BASE)}
          </Text>
          <Text variant="micro" className="text-text-muted">
            {EMBEDDED_TOKEN
              ? "This build carries its own token. Saving a token here overrides it on this device only; \"Use the build's token\" switches back."
              : "This build has no token. Save one here to use the app; it stays in the device keychain."}
          </Text>
        </Card>

        <Card className="gap-3">
          <Text variant="eyebrow">Server</Text>
          <Text variant="micro" className="text-text-muted">API base URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://soma.example.com"
            placeholderTextColor="#5a7a8a"
            testID="login-url"
            accessibilityLabel="API base URL"
            className="rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2.5 text-text"
            style={{ fontSize: 14 }}
          />
          <Text variant="micro" className="text-text-muted">Personal API token</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            placeholder={source === "embedded" ? "Leave empty to keep the build's token" : "Paste the token from the web dashboard"}
            placeholderTextColor="#5a7a8a"
            testID="login-token"
            accessibilityLabel="Personal API token"
            className="rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2.5 text-text"
            style={{ fontSize: 14 }}
          />
          <View className="flex-row flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" label={testing ? "Testing…" : "Test connection"} onPress={testConnection} disabled={testing} testID="login-test" />
            <Button variant="primary" size="sm" label="Save" onPress={save} testID="login-save" />
          </View>
          {result ? (
            <Text variant="caption" className={result.ok ? "text-success" : "text-warning"} testID="login-result">
              {result.text}
            </Text>
          ) : null}
          {note ? <Text variant="micro" className="text-text-secondary" testID="login-note">{note}</Text> : null}
        </Card>

        {source === "stored" || (EMBEDDED_TOKEN && url !== DEFAULT_API_BASE) ? (
          <Pressable onPress={useBuildToken} className="items-center py-2" testID="login-clear" accessibilityRole="button">
            <Text variant="caption" className="text-teal">{EMBEDDED_TOKEN ? "Use the build's token" : "Remove stored credentials"}</Text>
          </Pressable>
        ) : null}

        <Text variant="micro" className="text-text-muted">
          The token is created on the web dashboard under Settings and grants full access to your data. It is stored with the platform keychain on iOS and the keystore on Android, never in plain files.
        </Text>
      </View>
    </ScrollView>
  );
}
