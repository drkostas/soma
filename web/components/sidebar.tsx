"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Dumbbell,
  Footprints,
  Target,
  Mountain,
  Moon,
  Cable,
  Music2,
  UtensilsCrossed,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SyncButton } from "@/components/sync-button";
import { SomaLogo } from "@/components/soma-logo";

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Overview", shortcut: "1", mobile: true },
  { href: "/nutrition", icon: UtensilsCrossed, label: "Nutrition", shortcut: "0", mobile: true },
  { href: "/running", icon: Footprints, label: "Running", shortcut: "2", mobile: true },
  { href: "/training", icon: Target, label: "Training", shortcut: "3", mobile: false },
  { href: "/workouts", icon: Dumbbell, label: "Gym", shortcut: "4", mobile: true },
  { href: "/activities", icon: Mountain, label: "Activities", shortcut: "5", mobile: false },
  { href: "/sleep", icon: Moon, label: "Sleep", shortcut: "6", mobile: true },
  { href: "/playlist", icon: Music2, label: "Playlist", shortcut: "7", mobile: false },
  { href: "/connections", icon: Cable, label: "Sync", shortcut: "8", mobile: false },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const item = navItems.find((n) => n.shortcut === e.key);
      if (item) {
        e.preventDefault();
        router.push(item.href);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  // Close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Sticky top bar with hamburger */}
      <div className="fixed top-0 left-0 right-0 z-50 safe-area-pt safe-area-pl safe-area-pr bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="flex h-12 items-center px-1">
          <button
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-lg"
            aria-label="Toggle menu"
          >
            {drawerOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Slide-out drawer */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen w-56 flex-col border-r border-border bg-sidebar transition-transform duration-200 safe-area-pt safe-area-pl safe-area-pb",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo + close area */}
        <div className="flex h-14 items-center gap-3 px-4 border-b border-border">
          <div className="w-8" /> {/* spacer for hamburger */}
          <Link
            href="/"
            className="flex items-center gap-2"
            aria-label="Go to home"
          >
            <SomaLogo size={24} />
            <span className="text-sm font-semibold">Soma</span>
          </Link>
        </div>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col gap-0.5 p-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
                <span className="ml-auto text-[10px] text-muted-foreground/50 hidden md:inline">
                  ⌘{item.shortcut}
                </span>
              </Link>
            );
          })}

          {/* Sync button at bottom */}
          <div className="mt-auto pt-2 border-t border-border">
            <SyncButton />
          </div>
        </nav>
      </aside>

      {/* No bottom nav — hamburger drawer handles all navigation */}
    </>
  );
}

