"use client";

import { useState, useEffect, useCallback } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

interface Props {
  deviceCount: number;
}

export function PushNotificationManager({ deviceCount }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!("Notification" in window)) return;
    setPermission(Notification.permission);

    navigator.serviceWorker?.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(!!sub);
      });
    });
  }, []);

  // Listen for in-app push messages from SW
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_NOTIFICATION") {
        const { title, body } = event.data.payload;
        toast(title, { description: body });
      }
    };
    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, []);

  const subscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        toast.error("Notification permission denied");
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        toast.error("Push not configured");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const json = sub.toJSON();
      await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        }),
      });

      setIsSubscribed(true);
      toast.success("Push notifications enabled");
    } catch (err) {
      console.error("Subscribe failed:", err);
      toast.error("Failed to enable notifications");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/notifications/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
      setIsSubscribed(false);
      toast.success("Push notifications disabled for this device");
    } catch (err) {
      console.error("Unsubscribe failed:", err);
      toast.error("Failed to disable notifications");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const noSupport = typeof window !== "undefined" && !("Notification" in window);
  const denied = permission === "denied";

  return (
    <div className="flex items-center justify-between">
      <div className="text-sm text-muted-foreground">
        {isSubscribed ? (
          <div className="space-y-1">
            <p className="text-foreground font-medium">Notifications enabled</p>
            <p className="text-xs">{deviceCount} device{deviceCount !== 1 ? "s" : ""} subscribed</p>
          </div>
        ) : denied ? (
          <p className="text-xs">Blocked by browser. Reset in site settings.</p>
        ) : noSupport ? (
          <p className="text-xs">Not supported in this browser.</p>
        ) : (
          <p>Not enabled</p>
        )}
      </div>
      {!noSupport && !denied && (
        <button
          onClick={isSubscribed ? unsubscribe : subscribe}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-accent transition-colors disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isSubscribed ? (
            <BellOff className="h-3.5 w-3.5" />
          ) : (
            <Bell className="h-3.5 w-3.5" />
          )}
          {isSubscribed ? "Disable" : "Enable"}
        </button>
      )}
    </div>
  );
}
