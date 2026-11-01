import { describe, expect, it } from "vitest";
import { CROPS, STAGES, WEIGHTS, recommendCrops, stageFor, stageStartDay, validInputs, cropById, type CropInputs } from "../modules/farm/cropEngine";

const none: CropInputs = { soil: null, season: null, water: null, ph: null, duration: null, rainNext5dMm: null };

describe("crop recommendation engine", () => {
  it("weights add up to 100", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("reports every missing input and scores 0 with no inputs", () => {
    const r = recommendCrops(none);
    expect(r.missing).toEqual(["soil", "season", "water", "ph", "duration"]);
    expect(r.ranked.every((x) => x.score === 0 && x.checks.length === 0)).toBe(true);
  });

  it("is deterministic", () => {
    const inputs: CropInputs = { ...none, soil: "red", season: "kharif", water: "rainfed" };
    expect(recommendCrops(inputs)).toEqual(recommendCrops(inputs));
  });

  it("scores paddy 100 for irrigated black soil in kharif", () => {
    const r = recommendCrops({ ...none, soil: "black", season: "kharif", water: "irrigated", ph: 6.5 });
    expect(r.ranked.find((x) => x.crop.id === "paddy")!.score).toBe(100);
    expect(r.ranked[0].score).toBe(100);
    expect(r.missing).toEqual(["duration"]);
  });

  it("penalises high-water crops on rainfed land", () => {
    const r = recommendCrops({ ...none, water: "rainfed" });
    expect(r.ranked.find((x) => x.crop.id === "paddy")!.score).toBe(0);
    expect(r.ranked.find((x) => x.crop.id === "blackgram")!.score).toBe(100);
  });

  it("only uses given inputs in the denominator", () => {
    const r = recommendCrops({ ...none, soil: "laterite" });
    for (const rec of r.ranked) expect([0, 100]).toContain(rec.score);
  });

  it("gives partial credit for pH just outside range", () => {
    const tomato = CROPS.find((c) => c.id === "tomato")!;
    const r = recommendCrops({ ...none, ph: tomato.phMax + 0.3 }, [tomato]);
    expect(r.ranked[0].checks[0].result).toBe(0.5);
    expect(r.ranked[0].score).toBe(50);
  });

  it("raises heavy-rain and no-rain risks", () => {
    const heavy = recommendCrops({ ...none, rainNext5dMm: 80 });
    expect(heavy.ranked.every((x) => x.risks.includes("heavy_rain_sowing"))).toBe(true);
    expect(heavy.ranked.find((x) => x.crop.water === "low")!.risks).toContain("heavy_rain_low_water_crop");
    const dry = recommendCrops({ ...none, water: "rainfed", rainNext5dMm: 0 });
    expect(dry.ranked[0].risks).toContain("no_rain_rainfed");
  });

  it("validates inputs", () => {
    expect(validInputs({ ...none, soil: "sandy" })).toHaveLength(1);
    expect(validInputs({ ...none, ph: 12 })).toHaveLength(1);
    expect(validInputs({ ...none, soil: "red", ph: 6.8 })).toEqual([]);
  });

  it("every crop uses known soils and sane ranges", () => {
    for (const c of CROPS) {
      for (const s of c.soils) expect(validInputs({ ...none, soil: s })).toEqual([]);
      expect(c.phMin).toBeLessThan(c.phMax);
      expect(c.durationDays).toBeGreaterThan(30);
      expect(c.ta).toBeTruthy();
    }
  });
});

describe("crop growth stages", () => {
  const paddy = cropById("paddy")!;
  it("starts at the first stage and finishes at harvest", () => {
    expect(stageFor(paddy, 0).index).toBe(0);
    expect(stageFor(paddy, -5).index).toBe(0);
    const end = stageFor(paddy, paddy.durationDays);
    expect(end.done).toBe(true);
    expect(end.index).toBe(STAGES.length - 1);
  });
  it("stage start days are increasing", () => {
    const days = STAGES.map((s) => stageStartDay(paddy, s));
    expect(days[0]).toBe(0);
    for (let i = 1; i < days.length; i++) expect(days[i]).toBeGreaterThan(days[i - 1]);
  });
});
