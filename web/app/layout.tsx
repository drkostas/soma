import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import { DemoBanner } from "@/components/demo-banner";
import { Toaster } from "sonner";
import { SWRegister } from "@/components/sw-register";
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
          <main className={`ml-0 md:ml-16 min-h-screen bg-background pb-16 md:pb-0${isDemo ? " pt-8" : ""}`}>
            {children}
          </main>
          <Toaster richColors />
        </TooltipProvider>
        <SWRegister />
      </body>
    </html>
  );
}
