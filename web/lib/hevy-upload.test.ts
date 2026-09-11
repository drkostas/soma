import { describe, it, expect } from "vitest";
import { trainingLoadForUpload } from "./hevy-upload";

describe("trainingLoadForUpload", () => {
  it("is undefined unless HEVY2GARMIN_WRITE_TRAINING_LOAD=1", () => {
    expect(trainingLoadForUpload({ load_value: 62.4 }, { HEVY2GARMIN_WRITE_TRAINING_LOAD: "" })).toBeUndefined();
    expect(trainingLoadForUpload({ load_value: 62.4 }, { HEVY2GARMIN_WRITE_TRAINING_LOAD: "1" })).toBe(62.4);
  });
  it("never writes a zero or missing load", () => {
    expect(trainingLoadForUpload(null, { HEVY2GARMIN_WRITE_TRAINING_LOAD: "1" })).toBeUndefined();
    expect(trainingLoadForUpload({ load_value: 0 }, { HEVY2GARMIN_WRITE_TRAINING_LOAD: "1" })).toBeUndefined();
  });
});
