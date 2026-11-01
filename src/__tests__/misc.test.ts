import { describe, expect, it } from "vitest";
import { checkDimensions, checkFile, MAX_FILE_BYTES } from "../shared/ui/ImageCapture";
import { mapRecognitionError } from "../shared/voice/VoiceEngine";
import { formatInr, formatIsoDate, percent, relativeTime } from "../lib/format";
import { daysSince, DAY_MS } from "../modules/farm/my-crop/MyCrop";
import { matchDistrict, TN_DISTRICTS } from "../domain/districts";

describe("image validation", () => {
  it("rejects non-images, huge files and tiny images", () => {
    expect(checkFile({ type: "application/pdf", size: 10 })).toBe("not_image");
    expect(checkFile({ type: "image/jpeg", size: MAX_FILE_BYTES + 1 })).toBe("too_large");
    expect(checkFile({ type: "image/png", size: 1000 })).toBeNull();
    expect(checkDimensions(32, 500)).toBe("too_small");
    expect(checkDimensions(640, 480)).toBeNull();
  });
});

describe("voice errors", () => {
  it("maps Web Speech error codes", () => {
    expect(mapRecognitionError("not-allowed")).toBe("denied");
    expect(mapRecognitionError("no-speech")).toBe("no_speech");
    expect(mapRecognitionError("network")).toBe("network");
    expect(mapRecognitionError("weird")).toBe("error");
  });
});

describe("formatting", () => {
  it("formats INR with Indian grouping", () => {
    expect(formatInr(123456, "en")).toMatch(/1,23,456/);
  });
  it("formats ISO dates and passes through others", () => {
    expect(formatIsoDate("2026-10-31", "en")).toMatch(/31/);
    expect(formatIsoDate("unknown", "en")).toBe("unknown");
  });
  it("relative time and percent", () => {
    const now = 10 * DAY_MS;
    expect(relativeTime(now - 5 * 60_000, "en", now)).toMatch(/5/);
    expect(percent(0.8765)).toBe("87.7%");
  });
});

describe("my crop", () => {
  it("counts whole days since planting", () => {
    expect(daysSince(0, DAY_MS * 3.5)).toBe(3);
    expect(daysSince(DAY_MS * 5, 0)).toBe(0);
  });
});

describe("districts", () => {
  it("has 38 Tamil Nadu districts and matches names loosely", () => {
    expect(TN_DISTRICTS.length).toBe(38);
    expect(matchDistrict("madurai")).toBe("Madurai");
    expect(matchDistrict("Atlantis")).toBeNull();
  });
});
