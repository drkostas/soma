"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Settings2, Check, Loader2, Eye, EyeOff, ExternalLink } from "lucide-react";

interface FieldConfig {
  key: string;
  label: string;
  placeholder: string;
  sensitive: boolean;
  helpText?: string;
}

const PLATFORM_FIELDS: Record<string, FieldConfig[]> = {
  hevy: [
    {
      key: "api_key",
      label: "API Key",
      placeholder: "Enter your Hevy API key",
      sensitive: true,
      helpText: "Found in Hevy app → Settings → Developer",
    },
  ],
  telegram: [
    {
      key: "bot_token",
      label: "Bot Token",
      placeholder: "123456:ABC-DEF...",
      sensitive: true,
      helpText: "Get from @BotFather on Telegram",
    },
    {
      key: "chat_id",
      label: "Chat ID",
      placeholder: "-100123456789",
      sensitive: false,
      helpText: "Your personal or group chat ID",
    },
  ],
  garmin: [
    {
      key: "email",
      label: "Email",
      placeholder: "your@email.com",
      sensitive: false,
    },
    {
      key: "password",
      label: "Password",
      placeholder: "Enter your Garmin password",
      sensitive: true,
    },
  ],
};

interface CredentialsDialogProps {
  platform: string;
  platformLabel: string;
  isConfigured: boolean;
}

export function CredentialsDialog({
  platform,
  platformLabel,
  isConfigured,
}: CredentialsDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [maskedValues, setMaskedValues] = useState<Record<string, string | null>>({});
  const [fieldSources, setFieldSources] = useState<Record<string, string>>({});
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = PLATFORM_FIELDS[platform] || [];

  useEffect(() => {
    if (open) {
      setSaved(false);
      setError(null);
      setValues({});
      // Fetch current masked values and sources
      fetch(`/api/connections/${platform}`)
        .then((r) => r.json())
        .then((data) => {
          setMaskedValues(data.fields || {});
          setFieldSources(data.sources || {});
        })
        .catch(() => {});
    }
  }, [open, platform]);

  async function handleSave() {
    // Validate that all required fields have values (either new or existing)
    const missingFields = fields.filter(
      (f) => !values[f.key] && !maskedValues[f.key]
    );
    if (missingFields.length > 0) {
      setError(`Missing: ${missingFields.map((f) => f.label).join(", ")}`);
      return;
    }

    // Only send fields that have new values
    const payload: Record<string, string> = {};
    for (const f of fields) {
      if (values[f.key]) {
        payload[f.key] = values[f.key];
      }
    }

    if (Object.keys(payload).length === 0) {
      setOpen(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/connections/${platform}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }
      setSaved(true);
      setTimeout(() => {
        setOpen(false);
        router.refresh();
      }, 800);
    } catch {
      setError("Failed to save credentials");
    } finally {
      setSaving(false);
    }
  }

  if (fields.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4" />
          {isConfigured ? "Settings" : "Configure"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{platformLabel} Configuration</DialogTitle>
          <DialogDescription>
            Configure credentials for {platformLabel} integration.
            {isConfigured && " Fields show masked current values."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {field.label}
              </label>
              <div className="relative">
                <input
                  type={field.sensitive && !showSensitive[field.key] ? "password" : "text"}
                  value={values[field.key] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                  placeholder={
                    maskedValues[field.key]
                      ? maskedValues[field.key]!
                      : field.placeholder
                  }
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                />
                {field.sensitive && (
                  <button
                    type="button"
                    onClick={() =>
                      setShowSensitive((s) => ({
                        ...s,
                        [field.key]: !s[field.key],
                      }))
                    }
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showSensitive[field.key] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
              {fieldSources[field.key] === "environment" && !values[field.key] && (
                <p className="text-xs text-blue-400">Set via environment variable</p>
              )}
              {fieldSources[field.key] === "database" && !values[field.key] && (
                <p className="text-xs text-green-400">Stored in database</p>
              )}
              {field.helpText && !fieldSources[field.key] && (
                <p className="text-xs text-muted-foreground">{field.helpText}</p>
              )}
            </div>
          ))}

          {platform === "garmin" && (
            <GarminBrowserAuth
              onSuccess={() => {
                setSaved(true);
                setTimeout(() => { setOpen(false); router.refresh(); }, 800);
              }}
              onError={setError}
            />
          )}

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || saved}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : saved ? (
                <>
                  <Check className="h-4 w-4" />
                  Saved
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const GARMIN_SSO_URL =
  "https://sso.garmin.com/sso/signin?id=gauth-widget&embedWidget=true" +
  "&gauthHost=https%3A%2F%2Fsso.garmin.com%2Fsso" +
  "&service=https%3A%2F%2Fsso.garmin.com%2Fsso%2Fembed" +
  "&source=https%3A%2F%2Fsso.garmin.com%2Fsso%2Fembed" +
  "&redirectAfterAccountLoginUrl=https%3A%2F%2Fsso.garmin.com%2Fsso%2Fembed" +
  "&redirectAfterAccountCreationUrl=https%3A%2F%2Fsso.garmin.com%2Fsso%2Fembed";

const CF_WORKER_URL = "https://hevy2garmin-exchange.gkos.workers.dev/exchange";

function GarminBrowserAuth({
  onSuccess,
  onError,
}: {
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [ticketUrl, setTicketUrl] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function handleConnect() {
    const raw = ticketUrl.trim();
    if (!raw) { onError("Paste the URL first"); return; }

    const ticketMatch = raw.match(/ticket=([^&\s]+)/);
    const ticket = ticketMatch ? ticketMatch[1] : raw.startsWith("ST-") ? raw : null;
    if (!ticket) { onError("No ticket found in URL. Copy the full URL after signing in."); return; }

    setConnecting(true);
    try {
      // Exchange ticket via CF Worker
      const exchResp = await fetch(CF_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      const exchData = await exchResp.json();
      if (exchData.error) { onError(exchData.error); return; }

      // Store tokens on our server
      const storeResp = await fetch("/api/connections/garmin/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exchData),
      });
      const storeData = await storeResp.json();
      if (storeData.ok) {
        onSuccess();
      } else {
        onError(storeData.error || "Failed to save tokens");
      }
    } catch {
      onError("Network error. Try again.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <p className="text-sm font-medium text-foreground">Browser Authentication</p>
      <p className="text-xs text-muted-foreground">
        Garmin blocks automated logins from cloud servers. Sign in with your browser instead:
      </p>
      <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
        <li>Click <strong>Sign into Garmin</strong> below</li>
        <li>Log in with your Garmin email and password</li>
        <li>Copy the URL from the address bar after login</li>
        <li>Paste it below and click <strong>Connect</strong></li>
      </ol>
      <a
        href={GARMIN_SSO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        Sign into Garmin
      </a>
      <div className="flex gap-2">
        <input
          type="text"
          value={ticketUrl}
          onChange={(e) => setTicketUrl(e.target.value)}
          placeholder="https://sso.garmin.com/sso/embed?ticket=ST-..."
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button size="sm" onClick={handleConnect} disabled={connecting}>
          {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Connect"}
        </Button>
      </div>
    </div>
  );
}
