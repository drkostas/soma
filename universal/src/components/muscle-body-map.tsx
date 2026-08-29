import { useMemo } from "react";
import { View } from "react-native";
import { Text } from "soma-style";
import Body, { type ExtendedBodyPart, type Slug } from "react-native-body-highlighter";
import {
  ALL_MUSCLE_GROUPS, MUSCLE_COLORS, MUSCLE_TO_SLUGS, SLUG_TO_MUSCLE, hexToRgba, type MuscleGroup,
} from "../lib/muscle-groups";

export interface MuscleVolumes { [key: string]: { primary: number; secondary: number; total: number } }

/**
 * Anatomical front + back figures coloured by per-muscle training intensity.
 * Mobile port of the web MuscleBodyMap (which uses react-body-highlighter, a
 * DOM-only lib) via react-native-body-highlighter — same intensity model
 * (alpha = 0.2 + share*0.75, dimmed when another muscle is selected) driven by
 * a per-part `color`, with tap-to-select mapped back through the slug table.
 */
export function MuscleBodyMap({ volumes, selected, onSelect, scale = 1 }: {
  volumes: MuscleVolumes;
  selected: MuscleGroup | null;
  onSelect: (m: MuscleGroup | null) => void;
  scale?: number;
}) {
  const maxTotal = useMemo(
    () => Math.max(...ALL_MUSCLE_GROUPS.map((mg) => volumes[mg]?.total ?? 0), 1),
    [volumes],
  );

  const data = useMemo<ExtendedBodyPart[]>(() => {
    const out: ExtendedBodyPart[] = [];
    for (const mg of ALL_MUSCLE_GROUPS) {
      const total = volumes[mg]?.total ?? 0;
      if (total <= 0) continue;
      const intensity = total / maxTotal;
      const alpha = selected
        ? mg === selected ? Math.min(0.95, 0.5 + intensity * 0.45) : 0.06 + intensity * 0.12
        : 0.2 + intensity * 0.75;
      const color = hexToRgba(MUSCLE_COLORS[mg], alpha);
      for (const slug of MUSCLE_TO_SLUGS[mg]) out.push({ slug: slug as Slug, color });
    }
    return out;
  }, [volumes, maxTotal, selected]);

  const onPress = (b: ExtendedBodyPart) => {
    const mg = b.slug ? SLUG_TO_MUSCLE[b.slug] : undefined;
    if (mg) onSelect(selected === mg ? null : mg);
  };

  return (
    <View className="flex-row items-start justify-center gap-4">
      <View className="items-center">
        <Text variant="micro" className="text-text-muted mb-1">Front</Text>
        <Body data={data} side="front" scale={scale} defaultFill="#2a2a2e" border="none" onBodyPartPress={onPress} />
      </View>
      <View className="items-center">
        <Text variant="micro" className="text-text-muted mb-1">Back</Text>
        <Body data={data} side="back" scale={scale} defaultFill="#2a2a2e" border="none" onBodyPartPress={onPress} />
      </View>
    </View>
  );
}
