"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Dumbbell,
  Footprints,
  Mountain,
  Moon,
  Activity,
  ShieldCheck,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SyncButton } from "@/components/sync-button";

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Overview" },
  { href: "/running", icon: Footprints, label: "Running" },
  { href: "/workouts", icon: Dumbbell, label: "Gym" },
  { href: "/activities", icon: Mountain, label: "Activities" },
  { href: "/sleep", icon: Moon, label: "Sleep" },
  { href: "/review", icon: ShieldCheck, label: "Review" },
  { href: "/status", icon: Activity, label: "Status" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-16 flex-col border-r border-border bg-sidebar">
      {/* Logo */}
      <div className="flex h-14 items-center justify-center border-b border-border">
        <span className="text-lg font-bold text-primary">S</span>
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
                  className={cn(
                    "relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-[-12px] w-[3px] h-6 rounded-r-full bg-primary" />
                  )}
                  <Icon className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {item.label}
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
  );
}
