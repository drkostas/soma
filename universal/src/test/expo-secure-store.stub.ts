/** In-memory stand-in for expo-secure-store under vitest (the real module pulls react-native's
 *  Flow sources through expo-modules-core, which Vite cannot parse). Aliased in vitest.config.ts. */
const store = new Map<string, string>();
export async function getItemAsync(key: string): Promise<string | null> { return store.get(key) ?? null; }
export async function setItemAsync(key: string, value: string): Promise<void> { store.set(key, value); }
export async function deleteItemAsync(key: string): Promise<void> { store.delete(key); }
export async function isAvailableAsync(): Promise<boolean> { return true; }
