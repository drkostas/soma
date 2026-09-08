import { useState, type ReactNode } from "react";
import { Modal, View, Pressable } from "react-native";
import { Text } from "soma-style";
import { Map, Camera } from "@maplibre/maplibre-react-native";

/** OpenFreeMap dark vector basemap — free, OSM data, no API key (the same style the inline maps use). */
export const DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";

/**
 * Fullscreen, pannable and zoomable MapLibre view (soma#793). The inline maps stay static
 * like web's `interactive={false}` maps (a pannable map inside a ScrollView traps vertical
 * drags); tapping their ⤢ opens this modal with drag, pinch and double-tap zoom enabled.
 * Children are the GeoJSON sources/layers to draw; `bounds` fits the camera.
 */
export function MapFullscreen({
  visible,
  onClose,
  title,
  bounds,
  children,
  legend,
  testID = "map-fullscreen",
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  bounds: [number, number, number, number];
  children: ReactNode;
  legend?: ReactNode;
  testID?: string;
}) {
  // The Camera fits `bounds` when the Map mounts; inside a Modal that is still animating in,
  // the view can measure 0×0 and the fit lands zoomed far out (the heatmap opened on a whole
  // state). Mount the Map only once the container has a real size.
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-base" testID={testID}>
        <View className="flex-row items-center justify-between px-4 pb-2 pt-12">
          <Text variant="body" className="text-text flex-1" numberOfLines={1}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close map" testID={`${testID}-close`} className="rounded-full bg-surface-subtle px-3 py-1.5">
            <Text variant="caption" className="text-teal">Close</Text>
          </Pressable>
        </View>
        <View className="flex-1" onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {size.w > 0 && size.h > 0 ? (
          <Map
            style={{ flex: 1 }}
            mapStyle={DARK_STYLE}
            attribution={false}
            logo={false}
            dragPan
            touchZoom
            doubleTapZoom
            doubleTapHoldZoom
            touchRotate={false}
            touchPitch={false}
          >
            <Camera bounds={bounds} padding={{ top: 40, bottom: 40, left: 40, right: 40 }} />
            {children}
          </Map>
          ) : null}
          {legend ? <View className="absolute bottom-3 left-3">{legend}</View> : null}
        </View>
        {/* Sits above the gesture handle. */}
        <Text variant="micro" className="text-text-muted px-4 pt-2 pb-8" style={{ fontSize: 9 }}>
          © OpenFreeMap · © OpenStreetMap contributors · drag to pan, pinch or double-tap to zoom
        </Text>
      </View>
    </Modal>
  );
}
