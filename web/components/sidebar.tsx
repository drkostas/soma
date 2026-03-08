"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  LayoutDashboard,
  Dumbbell,
  Footprints,
  Target,
  Mountain,
  Moon,
  Cable,
  Music2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SyncButton } from "@/components/sync-button";
import { SomaLogo } from "@/components/soma-logo";

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Overview", shortcut: "1" },
  { href: "/running", icon: Footprints, label: "Running", shortcut: "2" },
  { href: "/training", icon: Target, label: "Training", shortcut: "3" },
  { href: "/workouts", icon: Dumbbell, label: "Gym", shortcut: "4" },
  { href: "/activities", icon: Mountain, label: "Activities", shortcut: "5" },
  { href: "/sleep", icon: Moon, label: "Sleep", shortcut: "6" },
  { href: "/playlist", icon: Music2, label: "Playlist", shortcut: "7" },
  { href: "/connections", icon: Cable, label: "Sync", shortcut: "8" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Only trigger with Cmd (Mac) or Ctrl (Win/Linux)
      if (!(e.metaKey || e.ctrlKey)) return;
      // Don't intercept when typing in inputs
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

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-16 flex-col border-r border-border bg-sidebar">
        {/* Logo */}
        <div className="flex h-14 items-center justify-center border-b border-border">
          <Link
            href="/"
            className="flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 hover:scale-110 hover:shadow-[0_0_12px_var(--primary)]"
            aria-label="Go to home"
          >
            <SomaLogo size={30} />
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col items-center gap-1 py-3">
          {navItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Tooltip key={item.label} delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative flex h-10 w-10 items-center justify-center rounded-lg transition-all duration-200",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-[-12px] w-[4px] h-6 rounded-r-full bg-primary shadow-[0_0_8px_var(--primary)]" />
                    )}
                    <Icon className="h-5 w-5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  <span>{item.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">⌘{item.shortcut}</span>
                </TooltipContent>
              </Tooltip>
            );
          })}

          {/* Sync button pushed to bottom */}
          <div className="mt-auto pb-3">
            <SyncButton />
          </div>
        </nav>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-border bg-sidebar px-1 py-1 safe-area-pb">
        {navItems.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center min-w-[44px] min-h-[44px] rounded-lg transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] mt-0.5 leading-none">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
