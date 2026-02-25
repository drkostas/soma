import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import { DemoBanner } from "@/components/demo-banner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const isDemo = process.env.DEMO_MODE === "true";

export const metadata: Metadata = {
  title: "Soma — Personal Health Intelligence",
  description: "Science-driven personal health dashboard",
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
          <main className={`ml-16 min-h-screen bg-background${isDemo ? " pt-8" : ""}`}>
            {children}
          </main>
        </TooltipProvider>
      </body>
    </html>
  );
}
