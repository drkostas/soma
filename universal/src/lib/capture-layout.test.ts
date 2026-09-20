/**
 * Nothing that can grow may sit in the row with Send.
 *
 * ⛔ THIS HAS NOW HAPPENED TWICE. The control row is `flex-row` with a `flex-1` spacer, so
 * anything placed in it competes with Send for the width, and on a phone Send goes off the right
 * edge. First the upload error did it, and when I moved the error out I left the acknowledgement
 * behind, so "Got it, logging it now." did it again with a longer string.
 *
 * Components cannot be rendered here, because vitest cannot parse react-native's Flow sources, so
 * this reads the source and checks the shape. That is enough: the fault is structural.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(here, "../components/MealCaptureInput.tsx");

/** The control row: from the flex-row that holds Send to the View that closes it. */
function controlRow(source: string): string {
  const start = source.indexOf('<View className="flex-row items-center gap-3 mt-2">');
  expect(start, "the control row moved; update this test rather than deleting it").toBeGreaterThan(-1);
  const end = source.indexOf("</View>", source.indexOf("testID=\"meal-capture-send\"", start));
  return source.slice(start, end);
}

describe("the capture box's control row", () => {
  const source = readFileSync(INPUT, "utf8");

  it("holds Send", () => {
    expect(controlRow(source)).toContain('testID="meal-capture-send"');
  });

  it("holds no message that can grow and push Send off the screen", () => {
    const row = controlRow(source);
    for (const binding of ["{ack", "{error", "{replyError"]) {
      expect(row, `${binding} is in the row with Send, which is how Send left the screen twice`)
        .not.toContain(binding);
    }
  });

  it("still shows both messages, above the row", () => {
    const above = source.slice(0, source.indexOf('<View className="flex-row items-center gap-3 mt-2">'));
    expect(above).toContain("{error");
    expect(above).toContain("{ack");
  });
});
