/** Stand-in for expo-image-manipulator under vitest; the real module reaches react-native's Flow
 *  sources, like expo-secure-store and expo-file-system/legacy beside it. */
export const SaveFormat = { JPEG: "jpeg", PNG: "png", WEBP: "webp" } as const;
export const ImageManipulator = {
  manipulate(uri: string) {
    return {
      resize: () => ({
        renderAsync: async () => ({ saveAsync: async () => ({ uri: `${uri}.small.jpg` }) }),
      }),
    };
  },
};
