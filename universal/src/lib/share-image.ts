import { Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

/** Download a rendered PNG (with the app's auth header) and hand the FILE to the share
 *  sheet — web offers "Download PNG"; a bare URL would reach the recipient without the
 *  header and 401 (soma#760, #761). On Expo web falls back to the system share. */
export async function shareImageFile(img: { uri: string; headers?: Record<string, string> }, fileName: string, title: string): Promise<void> {
  if (Platform.OS === "web") { await Share.share({ url: img.uri, message: title }).catch(() => {}); return; }
  const target = `${FileSystem.cacheDirectory ?? ""}${fileName}`;
  const res = await FileSystem.downloadAsync(img.uri, target, { headers: img.headers });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(res.uri, { mimeType: "image/png", dialogTitle: title });
  else await Share.share({ url: res.uri, message: title }).catch(() => {});
}
