"use client";

import { useState } from "react";
import { StatCard } from "@/components/stat-card";
import { StatDetailDialog } from "@/components/stat-detail-dialog";

interface StatCardData {
  metric: string;
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
}

interface ClickableStatCardsProps {
  primaryCards: StatCardData[];
  secondaryCards: StatCardData[];
}

export function ClickableStatCards({
  primaryCards,
  secondaryCards,
}: ClickableStatCardsProps) {
  const [openMetric, setOpenMetric] = useState<string | null>(null);

  return (
    <>
      {/* Primary Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {primaryCards.map((card) => (
          <StatCard
            key={card.metric}
            title={card.title}
            value={card.value}
            subtitle={card.subtitle}
            icon={card.icon}
            onClick={() => setOpenMetric(card.metric)}
          />
        ))}
      </div>

      {/* Secondary Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {secondaryCards.map((card) => (
          <StatCard
            key={card.metric}
            title={card.title}
            value={card.value}
            subtitle={card.subtitle}
            icon={card.icon}
            onClick={() => setOpenMetric(card.metric)}
          />
        ))}
      </div>

      {/* Detail Dialog */}
      <StatDetailDialog
        metric={openMetric}
        open={openMetric !== null}
        onOpenChange={(open) => {
          if (!open) setOpenMetric(null);
        }}
      />
    </>
  );
}
