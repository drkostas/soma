import { describe, it, expect } from "vitest";
import { ALLOWED_MIME, DB_PREFIX, extFor, isAudio, isDbRef, MAX_BYTES, refToId, refuse } from "./capture-media";

describe("isDbRef and refToId", () => {
  const id = "2b29a8d5-f0c9-4eff-a408-4492f0ab0ce5";

  it("recognises a reference to a stored image", () => {
    expect(isDbRef(`${DB_PREFIX}${id}`)).toBe(true);
    expect(refToId(`${DB_PREFIX}${id}`)).toBe(id);
  });

  it("leaves a plain path alone, because the website's own uploads are paths", () => {
    expect(isDbRef("/tmp/soma-meal/x.jpg")).toBe(false);
    expect(refToId("/tmp/soma-meal/x.jpg")).toBeNull();
  });

  it("survives null and undefined rather than throwing on a message with no image", () => {
    expect(isDbRef(null)).toBe(false);
    expect(isDbRef(undefined)).toBe(false);
  });

  it("refuses anything that is not a uuid, because this value reaches a query", () => {
    expect(refToId(`${DB_PREFIX}not-a-uuid`)).toBeNull();
    expect(refToId(`${DB_PREFIX}' OR 1=1 --`)).toBeNull();
    expect(refToId(`${DB_PREFIX}`)).toBeNull();
  });
});

describe("extFor", () => {
  it("names the file after what it actually is", () => {
    expect(extFor("image/png")).toBe("png");
    expect(extFor("image/webp")).toBe("webp");
    expect(extFor("image/jpeg")).toBe("jpg");
    expect(extFor("image/jpg")).toBe("jpg");
  });
});

describe("refuse", () => {
  it("accepts the kinds a phone camera produces", () => {
    for (const m of ALLOWED_MIME) expect(refuse(m, 1024)).toBeNull();
  });

  it("names the type it cannot read, rather than saying it would not upload", () => {
    const why = refuse("image/heic", 1024);
    expect(why).toContain("image/heic");
    expect(why).toContain("JPEG");
  });

  it("says how big the photo was and what the limit is", () => {
    // Derived, not hardcoded: the limit is bounded by the db gateway and has moved once already.
    const over = MAX_BYTES + 5 * 1024 * 1024;
    const why = refuse("image/jpeg", over);
    expect(why).toContain(`${(over / 1024 / 1024).toFixed(1)} MB`);
    expect(why).toContain(`${MAX_BYTES / 1024 / 1024} MB`);
  });

  it("accepts a photo right on the limit and refuses one just over", () => {
    expect(refuse("image/jpeg", MAX_BYTES)).toBeNull();
    expect(refuse("image/jpeg", MAX_BYTES + 1)).not.toBeNull();
  });

  it("catches an empty file, which reads as success everywhere else", () => {
    expect(refuse("image/jpeg", 0)).toContain("empty");
  });

  it("says something about a missing type instead of printing nothing", () => {
    expect(refuse("", 1024)).toContain("that kind of file");
  });
});

describe("audio", () => {
  it("accepts what the phone's recogniser persists, on both platforms", () => {
    expect(refuse("audio/wav", 400_000)).toBeNull();
    expect(refuse("audio/x-caf", 400_000)).toBeNull();
    expect(isAudio("audio/wav")).toBe(true);
    expect(isAudio("image/jpeg")).toBe(false);
  });

  it("names a recording a recording when it refuses one", () => {
    expect(refuse("audio/wav", 9_000_000)).toContain("recording");
    expect(refuse("image/jpeg", 9_000_000)).toContain("photo");
  });

  it("writes it out with an extension whisper can open", () => {
    expect(extFor("audio/wav")).toBe("wav");
    expect(extFor("audio/m4a")).toBe("m4a");
    expect(extFor("audio/x-caf")).toBe("caf");
  });

  it("still refuses a file type neither side reads", () => {
    expect(refuse("application/pdf", 1000)).toContain("cannot read");
  });
});
