import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Where a self-hosted install keeps its API base URL and bearer token (soma#796). Native uses
 * the platform keychain / keystore through expo-secure-store; Expo web has no secure store, so it
 * falls back to localStorage via AsyncStorage (the token is then only as private as the browser).
 * The embedded-token build never writes here: with nothing stored, `applyStoredAuth` is a no-op.
 */
export interface StoredAuth { baseUrl: string; token: string }

const KEY_URL = "soma_api_base_url";
const KEY_TOKEN = "soma_api_token";
// process.env.EXPO_OS is inlined by Expo at build time; react-native itself is not imported here
// so lib/api stays importable under vitest (react-native ships Flow sources).
const secure = process.env.EXPO_OS !== "web";

async function read(key: string): Promise<string | null> {
  return secure ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key);
}
async function write(key: string, value: string): Promise<void> {
  return secure ? SecureStore.setItemAsync(key, value) : AsyncStorage.setItem(key, value);
}
async function remove(key: string): Promise<void> {
  return secure ? SecureStore.deleteItemAsync(key) : AsyncStorage.removeItem(key);
}

export async function getStoredAuth(): Promise<StoredAuth | null> {
  const [baseUrl, token] = await Promise.all([read(KEY_URL), read(KEY_TOKEN)]);
  if (!baseUrl && !token) return null;
  return { baseUrl: baseUrl ?? "", token: token ?? "" };
}

export async function saveStoredAuth(auth: StoredAuth): Promise<void> {
  await write(KEY_URL, auth.baseUrl);
  if (auth.token) await write(KEY_TOKEN, auth.token);
  else await remove(KEY_TOKEN);
}

export async function clearStoredAuth(): Promise<void> {
  await Promise.all([remove(KEY_URL), remove(KEY_TOKEN)]);
}
