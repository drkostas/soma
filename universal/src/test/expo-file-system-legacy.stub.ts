/**
 * In-memory stand-in for `expo-file-system/legacy` under vitest.
 *
 * The real module pulls react-native's Flow sources through expo-modules-core, and Vite cannot
 * parse them: `RolldownError: Flow is not supported`. That is why this app's tests live in
 * `src/lib` and never import a component, and why `expo-secure-store` is stubbed beside this.
 *
 * `readAsStringAsync` returns whatever `__setFile` was given, so a test can decide what the
 * picked photo contains, including nothing.
 */
export const EncodingType = { Base64: "base64", UTF8: "utf8" } as const;

let contents: string | Error = "";

/** Test-only: what the next read returns, or the error it throws. */
export function __setFile(next: string | Error): void {
  contents = next;
}

export async function readAsStringAsync(_uri: string, _opts?: unknown): Promise<string> {
  if (contents instanceof Error) throw contents;
  return contents;
}

export async function getInfoAsync(_uri: string): Promise<{ exists: boolean; size: number }> {
  return { exists: true, size: typeof contents === "string" ? contents.length : 0 };
}
