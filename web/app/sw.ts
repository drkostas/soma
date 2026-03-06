/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & WorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// --- Push Notifications ---

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const payload = event.data.json() as {
    title: string;
    body: string;
    url?: string;
    icon?: string;
    event_type?: string;
  };

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: false })
      .then((clients) => {
        const focusedClient = clients.find(
          (c) => c.visibilityState === "visible",
        );
        if (focusedClient) {
          // App is in foreground — post message for in-app toast instead
          focusedClient.postMessage({
            type: "PUSH_NOTIFICATION",
            payload,
          });
          return;
        }

        return self.registration.showNotification(payload.title, {
          body: payload.body,
          icon: payload.icon || "/icons/icon-192x192.png",
          badge: "/icons/icon-192x192.png",
          data: { url: payload.url || "/" },
        });
      }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data as { url?: string })?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (
          client.url.includes(self.location.origin) &&
          "focus" in client
        ) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
