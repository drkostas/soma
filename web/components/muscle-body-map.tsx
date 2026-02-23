"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Model from "react-body-highlighter";
import type { IExerciseData, IMuscleStats } from "react-body-highlighter";
import {
  type MuscleGroup,
  MUSCLE_LABELS,
  MUSCLE_COLORS,
  ALL_MUSCLE_GROUPS,
} from "@/lib/muscle-groups";

interface MuscleVolumes {
  [key: string]: { primary: number; secondary: number; total: number };
}

interface Props {
  volumes: MuscleVolumes;
  onMuscleClick?: (muscle: MuscleGroup) => void;
  hoveredMuscle?: MuscleGroup | null;
  onHoverChange?: (muscle: MuscleGroup | null) => void;
  compact?: boolean;
}

const MUSCLE_TO_LIBRARY: Record<MuscleGroup, string[]> = {
  chest: ["chest"],
  back: ["upper-back", "lower-back", "trapezius"],
  shoulders: ["front-deltoids", "back-deltoids"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  forearms: ["forearm"],
  quads: ["quadriceps"],
  hamstrings: ["hamstring"],
  glutes: ["gluteal"],
  calves: ["calves"],
  core: ["abs", "obliques"],
};

const LIBRARY_TO_MUSCLE: Record<string, MuscleGroup> = {};
for (const [mg, slugs] of Object.entries(MUSCLE_TO_LIBRARY)) {
  for (const slug of slugs) {
    LIBRARY_TO_MUSCLE[slug] = mg as MuscleGroup;
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

function parseRgb(color: string): [number, number, number] | null {
  const match = color.match(/(\d+)/g);
  if (match && match.length >= 3) {
    return [Number(match[0]), Number(match[1]), Number(match[2])];
  }
  return null;
}

function findMuscleByColor(r: number, g: number, b: number): { muscle: MuscleGroup; dist: number } | null {
  let bestMatch: MuscleGroup | null = null;
  let bestDist = Infinity;
  for (const mg of ALL_MUSCLE_GROUPS) {
    const hex = MUSCLE_COLORS[mg].hex;
    const mr = parseInt(hex.slice(1, 3), 16);
    const mgc = parseInt(hex.slice(3, 5), 16);
    const mb = parseInt(hex.slice(5, 7), 16);
    const dist = Math.abs(r - mr) + Math.abs(g - mgc) + Math.abs(b - mb);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = mg;
    }
  }
  return bestMatch ? { muscle: bestMatch, dist: bestDist } : null;
}

export function MuscleBodyMap({ volumes, onMuscleClick, hoveredMuscle: externalHovered, onHoverChange: externalHoverChange, compact }: Props) {
  const [internalHovered, setInternalHovered] = useState<MuscleGroup | null>(null);
  const hoveredMuscle = externalHovered !== undefined ? externalHovered : internalHovered;
  const onHoverChange = externalHoverChange || setInternalHovered;

  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef<MuscleGroup | null>(null);

  const maxTotal = useMemo(
    () => Math.max(...ALL_MUSCLE_GROUPS.map(mg => volumes[mg]?.total ?? 0), 1),
    [volumes]
  );

  // Base colors - NO hover state. Model renders once with these.
  const baseColors = useMemo(() => {
    return ALL_MUSCLE_GROUPS.map((mg) => {
      const total = volumes[mg]?.total ?? 0;
      const hex = MUSCLE_COLORS[mg].hex;
      const intensity = total > 0 ? total / maxTotal : 0;
      return hexToRgba(hex, total > 0 ? 0.2 + intensity * 0.75 : 0);
    });
  }, [volumes, maxTotal]);

  const { data, percentages } = useMemo(() => {
    const exercises: IExerciseData[] = [];
    const pcts: Record<string, number> = {};

    ALL_MUSCLE_GROUPS.forEach((mg, index) => {
      const total = volumes[mg]?.total ?? 0;
      if (total > 0) {
        exercises.push({
          name: MUSCLE_LABELS[mg],
          muscles: MUSCLE_TO_LIBRARY[mg] as any[],
          frequency: index + 1,
        });
        pcts[mg] = Math.round((total / maxTotal) * 100);
      }
    });

    return { data: exercises, percentages: pcts };
  }, [volumes, maxTotal]);

  const handleClick = useCallback((muscleStats: IMuscleStats) => {
    const ourMuscle = LIBRARY_TO_MUSCLE[muscleStats.muscle];
    if (ourMuscle && onMuscleClick) {
      onMuscleClick(ourMuscle);
    }
  }, [onMuscleClick]);

  // Tag SVG polygons with data-muscle after Model mounts
  useEffect(() => {
    const tagPolygons = (container: HTMLDivElement | null) => {
      if (!container) return;
      const polygons = container.querySelectorAll("polygon");
      polygons.forEach(polygon => {
        const fill = polygon.style.fill || window.getComputedStyle(polygon).fill;
        if (!fill) return;
        const rgb = parseRgb(fill);
        if (!rgb) return;
        const [r, g, b] = rgb;
        const result = findMuscleByColor(r, g, b);
        if (result && result.dist < 30 && (volumes[result.muscle]?.total ?? 0) > 0) {
          polygon.setAttribute("data-muscle", result.muscle);
        } else {
          polygon.removeAttribute("data-muscle");
        }
      });
    };
    const timer = setTimeout(() => {
      tagPolygons(frontRef.current);
      tagPolygons(backRef.current);
    }, 50);
    return () => clearTimeout(timer);
  }, [data, volumes]);

  // Apply hover effects via direct DOM manipulation - NO React re-render of Model
  useEffect(() => {
    hoveredRef.current = hoveredMuscle;

    const applyHover = (container: HTMLDivElement | null) => {
      if (!container) return;
      const polygons = container.querySelectorAll("polygon[data-muscle]");
      polygons.forEach(polygon => {
        const muscle = polygon.getAttribute("data-muscle") as MuscleGroup;
        if (!muscle) return;

        const total = volumes[muscle]?.total ?? 0;
        const hex = MUSCLE_COLORS[muscle].hex;
        const intensity = total > 0 ? total / maxTotal : 0;

        let fill: string;
        if (hoveredMuscle) {
          if (muscle === hoveredMuscle) {
            fill = hexToRgba(hex, Math.min(0.95, 0.5 + intensity * 0.45));
          } else {
            fill = hexToRgba(hex, 0.06 + intensity * 0.12);
          }
        } else {
          fill = hexToRgba(hex, total > 0 ? 0.2 + intensity * 0.75 : 0);
        }
        (polygon as SVGElement).style.fill = fill;
      });
    };

    applyHover(frontRef.current);
    applyHover(backRef.current);
  }, [hoveredMuscle, volumes, maxTotal]);

  // Hover detection via data-muscle attributes
  const handleSvgMouseOver = useCallback((e: React.MouseEvent) => {
    const target = e.target as SVGElement;
    if (target.tagName === "polygon") {
      const muscle = target.getAttribute("data-muscle") as MuscleGroup | null;
      if (muscle) {
        onHoverChange(muscle);
        return;
      }
    }
  }, [onHoverChange]);

  const handleSvgMouseLeave = useCallback(() => {
    onHoverChange(null);
  }, [onHoverChange]);

  const svgSize = compact ? { width: 140, height: 260 } : { width: 180, height: 340 };
  const hoveredData = hoveredMuscle ? volumes[hoveredMuscle] : null;

  return (
    <div className="flex flex-col items-center">
      <div className="flex gap-4 items-start justify-center">
        {/* Front view */}
        <div
          ref={frontRef}
          className="relative"
          onMouseOver={handleSvgMouseOver}
          onMouseLeave={handleSvgMouseLeave}
        >
          <p className="text-[10px] text-muted-foreground text-center mb-1">Front</p>
          <Model
            type="anterior"
            data={data}
            bodyColor="#2a2a2e"
            highlightedColors={baseColors}
            onClick={handleClick}
            style={svgSize}
          />
        </div>

        {/* Back view */}
        <div
          ref={backRef}
          className="relative"
          onMouseOver={handleSvgMouseOver}
          onMouseLeave={handleSvgMouseLeave}
        >
          <p className="text-[10px] text-muted-foreground text-center mb-1">Back</p>
          <Model
            type="posterior"
            data={data}
            bodyColor="#2a2a2e"
            highlightedColors={baseColors}
            onClick={handleClick}
            style={svgSize}
          />
        </div>
      </div>

      {/* Hover tooltip - fixed height container so it never shifts layout */}
      <div className="h-6 flex items-center justify-center">
        {hoveredMuscle && hoveredData && (
          <div className="px-3 py-0.5 bg-popover border border-border rounded-lg text-xs text-center shadow-md">
            <span className="font-medium" style={{ color: MUSCLE_COLORS[hoveredMuscle].hex }}>
              {MUSCLE_LABELS[hoveredMuscle]}
            </span>
            <span className="text-muted-foreground ml-2">{percentages[hoveredMuscle]}%</span>
            {hoveredData.primary > 0 && (
              <span className="text-muted-foreground ml-2">
                <span className="text-foreground">{Math.round(hoveredData.primary).toLocaleString()}</span> primary
              </span>
            )}
            {hoveredData.secondary > 0 && (
              <span className="text-muted-foreground ml-1">
                + <span className="text-foreground/60">{Math.round(hoveredData.secondary).toLocaleString()}</span> secondary
              </span>
            )}
          </div>
        )}
      </div>

      {/* Percentage legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-muted-foreground justify-center">
        {ALL_MUSCLE_GROUPS.filter(mg => percentages[mg] > 0)
          .sort((a, b) => (percentages[b] || 0) - (percentages[a] || 0))
          .map(mg => {
            const isHovered = hoveredMuscle === mg;
            const isDimmed = hoveredMuscle !== null && !isHovered;
            return (
              <span
                key={mg}
                className={`flex items-center gap-1 cursor-pointer transition-colors duration-150 ${
                  isHovered ? "text-foreground" : isDimmed ? "opacity-30" : "hover:text-foreground"
                }`}
                onMouseEnter={() => onHoverChange(mg)}
                onMouseLeave={() => onHoverChange(null)}
                onClick={() => onMuscleClick?.(mg)}
              >
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{
                    backgroundColor: MUSCLE_COLORS[mg].hex,
                    opacity: isHovered ? 1 : isDimmed ? 0.2 : 0.2 + ((percentages[mg] || 0) / 100) * 0.75,
                  }}
                />
                {MUSCLE_LABELS[mg]}
                <span className={`font-medium ${isHovered ? "text-foreground" : "text-foreground/70"}`}>
                  {percentages[mg]}%
                </span>
              </span>
            );
          })}
      </div>
    </div>
  );
}
