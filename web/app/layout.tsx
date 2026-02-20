import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

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
          <Sidebar />
          <main className="ml-16 min-h-screen bg-background">
            {children}
          </main>
        </TooltipProvider>
      </body>
    </html>
  );
}
