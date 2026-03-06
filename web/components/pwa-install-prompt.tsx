"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Download, Share } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(true); // start hidden

  useEffect(() => {
    // Already installed?
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // @ts-expect-error - iOS standalone check
    if (window.navigator.standalone === true) return;

    // Previously dismissed?
    const dismissedAt = localStorage.getItem("pwa-install-dismissed");
    if (dismissedAt) {
      const daysSince =
        (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
      if (daysSince < 14) return; // re-show after 2 weeks
    }

    // Chromium: listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setDismissed(false);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS Safari detection (no beforeinstallprompt support)
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as unknown as { MSStream?: unknown }).MSStream;
    const isSafari =
      /Safari/.test(navigator.userAgent) &&
      !/Chrome|CriOS|FxiOS/.test(navigator.userAgent);

    if (isIOS && isSafari) {
      setShowIOSHint(true);
      setDismissed(false);
    }

    // macOS Safari detection
    const isMacSafari =
      /Macintosh/.test(navigator.userAgent) && isSafari;
    if (isMacSafari) {
      setShowIOSHint(true); // reuse hint with different text
      setDismissed(false);
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDismissed(true);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem("pwa-install-dismissed", String(Date.now()));
  }, []);

  if (dismissed) return null;

  const isIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md animate-in slide-in-from-bottom-4 fade-in-0 duration-300">
      <div className="bg-card border border-border rounded-xl shadow-lg shadow-black/20 p-4 flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
          <Download className="h-5 w-5 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">Install Soma</p>
          {showIOSHint ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              {isIOS ? (
                <>
                  Tap <Share className="inline h-3 w-3 -mt-0.5" /> then{" "}
                  <span className="font-medium text-foreground">
                    &quot;Add to Home Screen&quot;
                  </span>
                </>
              ) : (
                <>
                  File &rarr;{" "}
                  <span className="font-medium text-foreground">
                    &quot;Add to Dock&quot;
                  </span>{" "}
                  to install
                </>
              )}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5">
              Add to your dock for quick access
            </p>
          )}
          {deferredPrompt && (
            <button
              onClick={handleInstall}
              className="mt-2 text-xs font-medium bg-emerald-500 text-zinc-950 px-3 py-1.5 rounded-md hover:bg-emerald-400 transition-colors"
            >
              Install
            </button>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 p-1 rounded-md hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
