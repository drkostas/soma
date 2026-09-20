/**
 * What happens when a photo will not upload, which used to be a single shrug.
 *
 * The real failure on 2026-09-20 was that React Native could not read the picker's URI, so the
 * `fetch` threw on the phone and no request ever reached the server: prod's logs for the whole
 * afternoon held no upload at all, while the box said "That photo would not upload". So the read
 * is ours now, and every failure says which one it was.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __setFile } from "../test/expo-file-system-legacy.stub";
import { MAX_PHOTO_BYTES, uploadCapturePhoto } from "./meal-capture";

const okJson = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

beforeEach(() => { __setFile("aGVsbG8="); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("uploadCapturePhoto", () => {
  it("returns the reference the server stored it under", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ path: "db:2b29a8d5-f0c9-4eff-a408-4492f0ab0ce5" })));
    const r = await uploadCapturePhoto("file:///x/meal.jpg");
    expect(r).toEqual({ ref: "db:2b29a8d5-f0c9-4eff-a408-4492f0ab0ce5" });
  });

  it("sends the bytes as JSON, not a URI for React Native to open", async () => {
    const fetchMock = vi.fn(async () => okJson({ path: "db:x" }));
    vi.stubGlobal("fetch", fetchMock);
    await uploadCapturePhoto("file:///x/meal.jpg");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(String((init.headers as Record<string, string>)["Content-Type"])).toContain("application/json");
    const body = JSON.parse(String(init.body)) as { mime: string; base64: string };
    expect(body.base64).toBe("aGVsbG8=");
    expect(body.mime).toBe("image/jpeg");
  });

  it("reads the type off the name, so a PNG is not called a JPEG", async () => {
    const fetchMock = vi.fn(async () => okJson({ path: "db:x" }));
    vi.stubGlobal("fetch", fetchMock);
    await uploadCapturePhoto("file:///x/plate.PNG");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { mime: string };
    expect(body.mime).toBe("image/png");
  });

  it("says the file could not be opened, which is the failure that actually happened", async () => {
    __setFile(new Error("ENOENT"));
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ path: "db:x" })));
    const r = await uploadCapturePhoto("content://media/picked");
    expect("error" in r && r.error).toContain("could not open that photo");
    expect("error" in r && r.error).toContain("ENOENT");
  });

  it("catches an empty file before troubling the network", async () => {
    __setFile("");
    const fetchMock = vi.fn(async () => okJson({ path: "db:x" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await uploadCapturePhoto("file:///x/meal.jpg");
    expect("error" in r && r.error).toContain("empty");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the server's own reason through, rather than replacing it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ error: "That photo is 15.0 MB and the limit is 10 MB." }, 415)));
    const r = await uploadCapturePhoto("file:///x/meal.jpg");
    expect("error" in r && r.error).toBe("That photo is 15.0 MB and the limit is 10 MB.");
  });

  it("names the status when the server gave no reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({}, 500)));
    const r = await uploadCapturePhoto("file:///x/meal.jpg");
    expect("error" in r && r.error).toContain("500");
  });

  it("says the server could not be reached, which is a different problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Network request failed"); }));
    const r = await uploadCapturePhoto("file:///x/meal.jpg");
    expect("error" in r && r.error).toContain("could not reach the server");
    expect("error" in r && r.error).toContain("Network request failed");
  });

  it("refuses an oversized photo before sending it, because the body is truncated otherwise", async () => {
    // A body over about 10 MB arrives truncated and the route throws a JSON parse error about a
    // character position, which is a terrible thing to show someone who took a photo.
    __setFile("A".repeat(Math.ceil(((MAX_PHOTO_BYTES + 1024 * 1024) * 4) / 3)));
    const fetchMock = vi.fn(async () => okJson({ path: "db:x" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await uploadCapturePhoto("file:///x/huge.jpg");
    expect("error" in r && r.error).toContain(`and the limit is ${MAX_PHOTO_BYTES / 1024 / 1024} MB`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a photo right on the limit", async () => {
    __setFile("A".repeat(Math.floor((MAX_PHOTO_BYTES * 4) / 3)));
    const fetchMock = vi.fn(async () => okJson({ path: "db:ok" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await uploadCapturePhoto("file:///x/edge.jpg")).toEqual({ ref: "db:ok" });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not claim success when the server answers without a reference", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({})));
    const r = await uploadCapturePhoto("file:///x/meal.jpg");
    expect("error" in r && r.error).toContain("without a reference");
  });
});

describe("the two caps agree", () => {
  it("is 3 MB, matching web/lib/capture-image.ts, which the db gateway bounds", () => {
    // A photo much over this cannot reach the database: the bytes go in as a bytea parameter and
    // the Neon HTTP driver sends a Buffer as a hex string, so the request is twice the photo, and
    // the gateway allows 8 MB.
    expect(MAX_PHOTO_BYTES).toBe(3 * 1024 * 1024);
  });
});
