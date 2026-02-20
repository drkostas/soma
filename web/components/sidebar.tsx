"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Activity,
  Moon,
  Dumbbell,
  Scale,
  RefreshCw,
  Heart,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", icon: LayoutDashboard, label: "Overview" },
  { href: "/status", icon: RefreshCw, label: "Sync Status" },
  // Future pages — shown as disabled
  { href: "#", icon: Activity, label: "Activity", disabled: true },
  { href: "#", icon: Moon, label: "Sleep", disabled: true },
  { href: "#", icon: Heart, label: "Heart", disabled: true },
  { href: "#", icon: Dumbbell, label: "Strength", disabled: true },
  { href: "#", icon: Scale, label: "Weight", disabled: true },
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

          if (item.disabled) {
            return (
              <Tooltip key={item.label} delayDuration={0}>
                <TooltipTrigger asChild>
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground/30 cursor-not-allowed"
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label} <span className="text-muted-foreground text-xs ml-1">Soon</span>
                </TooltipContent>
              </Tooltip>
            );
          }

          return (
            <Tooltip key={item.label} delayDuration={0}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}
