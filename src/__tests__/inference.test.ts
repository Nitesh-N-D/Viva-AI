import { describe, expect, it, vi } from "vitest";
import { validateModelMetadata } from "../lib/inference/metadata";
import { createClassifier, topK, type ModelIO } from "../lib/inference/classifier";

const labels = ["alluvial", "black", "laterite", "red"];
const validMeta = {
  schemaVersion: 1,
  task: "soil",
  status: "validated",
  modelVersion: "soil-2026.11.01",
  createdAt: "2026-11-01T00:00:00Z",
  architecture: "MobileNetV2",
  input: { height: 224, width: 224, channels: 3, preprocessing: "mobilenet_v2" },
  labels,
  minConfidence: 0.6,
  scoreType: "uncalibrated_softmax",
  training: { platform: "kaggle", accelerator: "T4", dataset: "x", notebook: "soil.ipynb" },
  evaluation: { file: "evaluation.json", testAccuracy: 0.9, macroF1: 0.88, testSamples: 200 },
};

describe("model metadata validation", () => {
  it("accepts a complete validated metadata file", () => {
    expect(validateModelMetadata(validMeta, "soil", labels)).toEqual([]);
  });
  it("rejects wrong task, unknown labels and label-order mismatch", () => {
    expect(validateModelMetadata(validMeta, "disease").length).toBeGreaterThan(0);
    expect(validateModelMetadata({ ...validMeta, labels: [...labels, "sandy"] }, "soil").join()).toMatch(/sandy/);
    expect(validateModelMetadata(validMeta, "soil", [...labels].reverse()).join()).toMatch(/order/);
  });
  it("requires evaluation and training provenance for validated models", () => {
    const { evaluation: _e, training: _t, ...rest } = validMeta;
    const errors = validateModelMetadata(rest, "soil");
    expect(errors.some((e) => e.includes("evaluation"))).toBe(true);
    expect(errors.some((e) => e.includes("training"))).toBe(true);
    expect(validateModelMetadata({ ...rest, status: "unverified" }, "soil")).toEqual([]);
  });
  it("rejects non-objects", () => {
    expect(validateModelMetadata(null, "soil")).toHaveLength(1);
    expect(validateModelMetadata([], "soil")).toHaveLength(1);
  });
});

describe("topK", () => {
  it("sorts scores and checks label count", () => {
    expect(topK([0.1, 0.7, 0.05, 0.15], labels, 2)).toEqual([
      { labelId: "black", score: 0.7 },
      { labelId: "red", score: 0.15 },
    ]);
    expect(() => topK([0.5, 0.5], labels, 1)).toThrow();
  });
});

describe("classifier loading", () => {
  const io = (files: Record<string, unknown>): ModelIO => ({
    loadTf: vi.fn(() => Promise.reject(new Error("tf must not load"))),
    fetchJson: async (url: string) => files[url.split("/").pop()!] ?? null,
    loadModel: vi.fn(),
  });

  it("reports awaiting_training when no metadata exists (no fake predictions)", async () => {
    const c = createClassifier(io({}));
    expect(await c.status("soil")).toMatchObject({ state: "awaiting_training" });
    const out = await c.classify("soil", document.createElement("canvas"));
    expect(out.status).toBe("awaiting_training");
  });

  it("refuses unverified models without loading TensorFlow", async () => {
    const files = { "metadata.json": { ...validMeta, status: "unverified" }, "labels.json": labels };
    const fake = io(files);
    const c = createClassifier(fake);
    expect(await c.status("soil")).toMatchObject({ state: "awaiting_training" });
    expect(fake.loadTf).not.toHaveBeenCalled();
  });

  it("reports an error for inconsistent metadata", async () => {
    const c = createClassifier(io({ "metadata.json": validMeta, "labels.json": ["red", "black"] }));
    expect(await c.status("soil")).toMatchObject({ state: "error" });
  });

  it("reports an error when the validated model fails to load", async () => {
    const c = createClassifier(io({ "metadata.json": validMeta, "labels.json": labels }));
    const s = await c.status("soil");
    expect(s.state).toBe("error");
  });
});
