import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import { DemoBanner } from "@/components/demo-banner";
import { Toaster } from "sonner";
import { SWRegister } from "@/components/sw-register";
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const isDemo = process.env.DEMO_MODE === "true";

export const metadata: Metadata = {
  title: {
    default: "Soma: Dashboard",
    template: "Soma: %s",
  },
  description: "Science-driven personal health dashboard",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Soma",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#10b981",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} antialiased`}>
        <TooltipProvider>
          {isDemo && (
            <DemoBanner repoUrl="https://github.com/drkostas/soma" />
          )}
          <Sidebar />
          <main className={`min-h-screen bg-background pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-4 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]${isDemo ? " md:pt-8" : ""}`}>
            {children}
          </main>
          <Toaster richColors />
        </TooltipProvider>
        <SWRegister />
        <PWAInstallPrompt />
      </body>
    </html>
  );
}
