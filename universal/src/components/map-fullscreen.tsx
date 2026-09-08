import { type ReactNode } from "react";
import { Modal, View, Pressable } from "react-native";
import { Text } from "soma-style";

export const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

/** Expo web fallback for the fullscreen map (soma#793): no native MapLibre view here, so the
 *  modal only carries the title, the legend and a note. The .native.tsx twin draws the map. */
export function MapFullscreen({
  visible,
  onClose,
  title,
  legend,
  testID = "map-fullscreen",
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  bounds: [number, number, number, number];
  children?: ReactNode;
  legend?: ReactNode;
  testID?: string;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-base p-4 gap-3" testID={testID}>
        <View className="flex-row items-center justify-between">
          <Text variant="body" className="text-text flex-1" numberOfLines={1}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close map" testID={`${testID}-close`}>
            <Text variant="caption" className="text-teal">Close</Text>
          </Pressable>
        </View>
        <Text variant="micro" className="text-text-muted">The pannable map renders in the native app.</Text>
        {legend}
      </View>
    </Modal>
  );
}
