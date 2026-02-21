"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Maximize2 } from "lucide-react";

interface ExpandableChartCardProps {
  title: string;
  subtitle?: string | React.ReactNode;
  icon?: React.ReactNode;
  /** Additional className for grid/layout positioning */
  className?: string;
  children: React.ReactNode;
}

export function ExpandableChartCard({
  title,
  subtitle,
  icon,
  className,
  children,
}: ExpandableChartCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card
        className={`cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20 group ${className || ""}`}
        onClick={() => setOpen(true)}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            {icon}
            {title}
            {subtitle && typeof subtitle === "string" ? (
              <span className="ml-auto text-xs font-normal">{subtitle}</span>
            ) : subtitle ? (
              <span className="ml-auto">{subtitle}</span>
            ) : null}
            <Maximize2 className="h-3.5 w-3.5 ml-auto opacity-0 group-hover:opacity-40 transition-opacity shrink-0" />
          </CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {icon}
              {title}
            </DialogTitle>
            {subtitle && typeof subtitle === "string" && (
              <DialogDescription>{subtitle}</DialogDescription>
            )}
          </DialogHeader>
          <div className="mt-2">{children}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
