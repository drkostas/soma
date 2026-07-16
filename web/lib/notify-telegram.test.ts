import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { stripAlpha } from "./notify-telegram";

/** Build a small RGBA PNG with a semi-transparent pixel. */
function rgbaPng(): Uint8Array {
  const png = new PNG({ width: 2, height: 1 });
  png.data.set([200, 100, 50, 128, 0, 0, 0, 0], 0); // px0 half-alpha, px1 transparent
  return PNG.sync.write(png); // RGBA (colorType 6)
}

describe("stripAlpha — RGBA → opaque RGB (Telegram-safe)", () => {
  it("outputs a valid RGB PNG (colorType 2)", () => {
    const input = rgbaPng();
    expect(input[25]).toBe(6); // RGBA in
    const out = stripAlpha(input);
    expect(out[0]).toBe(0x89); // PNG magic
    expect(out[25]).toBe(2);   // RGB out
  });

  it("flattens transparency onto the dark background (9,9,11)", () => {
    const out = PNG.sync.read(Buffer.from(stripAlpha(rgbaPng())));
    // px1 was fully transparent → becomes the background colour
    const i = 4;
    expect([out.data[i], out.data[i + 1], out.data[i + 2]]).toEqual([9, 9, 11]);
    expect(out.data[i + 3]).toBe(255); // opaque
  });
});
