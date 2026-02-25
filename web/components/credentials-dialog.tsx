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
import { Settings2, Check, Loader2, Eye, EyeOff } from "lucide-react";

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
      // Fetch current masked values
      fetch(`/api/connections/${platform}`)
        .then((r) => r.json())
        .then((data) => {
          setMaskedValues(data.fields || {});
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
              {field.helpText && (
                <p className="text-xs text-muted-foreground">{field.helpText}</p>
              )}
            </div>
          ))}

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
