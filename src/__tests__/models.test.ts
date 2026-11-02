/**
 * Model pipeline consistency: taxonomy ↔ guidance ↔ training notebooks,
 * artifact integrity checks used by `npm run model:import`, and a real TF.js
 * forward pass through the app's classifier using a tiny UNTRAINED fixture
 * model (random weights, created in-memory, used only to exercise the
 * pipeline; no training happens here and its outputs mean nothing).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as tf from "@tensorflow/tfjs";
import { DISEASE_CLASSES, SOIL_TYPES, TAXONOMY } from "../domain/taxonomy";
import guidance from "../modules/farm/data/guidance.json";
import { checkArtifact, finalUnits } from "../lib/inference/artifact";
import { createClassifier, preprocess, type ModelIO } from "../lib/inference/classifier";

const readJson = (p: string) => JSON.parse(readFileSync(resolve(p), "utf8"));

describe("taxonomy, guidance and notebooks agree", () => {
  it("every disease class has bilingual guidance and vice versa", () => {
    const ids = DISEASE_CLASSES.map((d) => d.id).sort();
    const conditions = guidance.conditions as Record<string, { symptoms: { en: unknown; ta: unknown } }>;
    expect(Object.keys(conditions).sort()).toEqual(ids);
    for (const c of Object.values(conditions)) {
      expect(c.symptoms.en).toBeTruthy();
      expect(c.symptoms.ta).toBeTruthy();
    }
  });

  for (const [task, dir] of [
    ["soil", "soil_classifier"],
    ["disease", "disease_classifier"],
  ] as const) {
    it(`${task}: class_map.json, notebook CLASS_DIRS and taxonomy list the same classes`, () => {
      const classMap = readJson(`packages/ml-models/${dir}/class_map.json`);
      expect(Object.keys(classMap).sort()).toEqual(TAXONOMY[task].map((t) => t.id).sort());

      const nb = readJson(`packages/ml-models/${dir}/train_colab.ipynb`);
      const src = nb.cells.map((c: { source: string[] }) => c.source.join("")).join("\n");
      const m = src.match(/CLASS_DIRS = json\.loads\(r'''(.*?)'''\)/);
      expect(m).not.toBeNull();
      expect(JSON.parse(m![1])).toEqual(classMap);
      expect(src).toContain('TASK = "' + task + '"');
      // The notebook must refuse non-cloud / non-GPU runtimes.
      expect(src).toContain("REFUSING TO RUN");
      expect(src).toContain("nvidia-smi");

      const kernel = readJson(`packages/ml-models/${dir}/kernel-metadata.template.json`);
      expect(kernel.enable_gpu).toBe(true);
      expect(kernel.machine_shape).toBe("NvidiaTeslaT4");
      expect(kernel.is_private).toBe(true);
    });
  }

  it("soil taxonomy is the four classes the dataset provides", () => {
    expect(SOIL_TYPES.map((s) => s.id)).toEqual(["alluvial", "black", "laterite", "red"]);
  });
});

// ---- artifact integrity -----------------------------------------------------

const soilLabels = ["alluvial", "black", "laterite", "red"];
const meta = {
  schemaVersion: 1,
  task: "soil",
  status: "validated",
  modelVersion: "soil-test",
  createdAt: "2026-11-01T00:00:00Z",
  architecture: "fixture",
  input: { height: 224, width: 224, channels: 3, preprocessing: "mobilenet_v2" },
  labels: soilLabels,
  minConfidence: 0.6,
  scoreType: "uncalibrated_softmax",
  training: { platform: "kaggle", accelerator: "T4", dataset: "x", notebook: "n.ipynb" },
  evaluation: { file: "evaluation.json", testAccuracy: 0.9, macroF1: 0.9, testSamples: 100 },
  integrity: { "group1-shard1of1.bin": "abc" },
};
const modelJson = (units = 4, paths = ["group1-shard1of1.bin"]) => ({
  format: "layers-model",
  modelTopology: {
    model_config: {
      class_name: "Functional",
      config: { layers: [{ class_name: "InputLayer", config: {} }, { class_name: "Dense", config: { units } }] },
    },
  },
  weightsManifest: [
    {
      paths,
      weights: [
        { name: "scores/kernel", shape: [8, units], dtype: "float32" },
        { name: "scores/bias", shape: [units], dtype: "float32" },
      ],
    },
  ],
});
const goodBytes = (8 * 4 + 4) * 4;
const files = (over: Partial<Parameters<typeof checkArtifact>[1]> = {}) => ({
  modelJson: modelJson(),
  labels: soilLabels,
  metadata: meta,
  sizes: { "group1-shard1of1.bin": goodBytes },
  sha256: { "group1-shard1of1.bin": "abc" },
  ...over,
});

describe("checkArtifact", () => {
  it("accepts a consistent folder", () => {
    expect(checkArtifact("soil", files())).toEqual([]);
    expect(finalUnits(modelJson(4))).toBe(4);
  });
  it("rejects a missing shard", () => {
    expect(checkArtifact("soil", files({ sizes: {} })).join()).toMatch(/missing weight shard/);
  });
  it("rejects a truncated shard", () => {
    expect(checkArtifact("soil", files({ sizes: { "group1-shard1of1.bin": goodBytes - 4 } })).join()).toMatch(/bytes/);
  });
  it("rejects a sha256 mismatch", () => {
    expect(checkArtifact("soil", files({ sha256: { "group1-shard1of1.bin": "zzz" } })).join()).toMatch(/sha256/);
  });
  it("rejects an output width that differs from labels", () => {
    const out = checkArtifact("soil", files({ modelJson: modelJson(3), sizes: { "group1-shard1of1.bin": (8 * 3 + 3) * 4 } }));
    expect(out.join()).toMatch(/3 units/);
  });
  it("rejects path traversal in shard names", () => {
    expect(checkArtifact("soil", files({ modelJson: modelJson(4, ["../evil.bin"]) })).join()).toMatch(/not allowed/);
  });
  it("rejects unverified metadata and graph models", () => {
    expect(checkArtifact("soil", files({ metadata: { ...meta, status: "unverified" } })).join()).toMatch(/validated/);
    expect(checkArtifact("soil", files({ modelJson: { ...modelJson(), format: "graph-model" } })).join()).toMatch(/layers-model/);
  });
});

// ---- real TF.js pipeline ----------------------------------------------------

describe("TF.js preprocessing and inference pipeline", () => {
  beforeAll(async () => {
    await tf.setBackend("cpu");
    await tf.ready();
  });

  it("normalises like MobileNetV2 (0 → −1, 255 → 1) at the model input size", () => {
    const white = tf.fill([10, 20, 3], 255) as tf.Tensor3D;
    const black = tf.zeros([10, 20, 3]) as tf.Tensor3D;
    const input = { height: 224, width: 224, preprocessing: "mobilenet_v2" as const };
    const w = preprocess(tf, white, input);
    const b = preprocess(tf, black, input);
    expect(w.shape).toEqual([1, 224, 224, 3]);
    expect(w.min().dataSync()[0]).toBeCloseTo(1, 5);
    expect(b.max().dataSync()[0]).toBeCloseTo(-1, 5);
    expect(preprocess(tf, white, { ...input, preprocessing: "rescale_0_1" }).max().dataSync()[0]).toBeCloseTo(1, 5);
    tf.dispose([white, black, w, b]);
  });

  it("runs a real (untrained fixture) layers model end to end", async () => {
    const fixture = tf.sequential({
      layers: [
        tf.layers.globalAveragePooling2d({ inputShape: [224, 224, 3] }),
        tf.layers.dense({ units: 4, activation: "softmax", name: "scores" }),
      ],
    });
    const io: ModelIO = {
      loadTf: async () => tf,
      fetchJson: async (url) => ({ "metadata.json": meta, "labels.json": soilLabels })[url.split("/").pop()!] ?? null,
      loadModel: async () => fixture,
    };
    const c = createClassifier(io);
    expect((await c.status("soil")).state).toBe("ready");
    const w = 32;
    const pixels = { width: w, height: w, data: new Uint8Array(w * w * 4).fill(128) };
    const out = await c.classify("soil", pixels as unknown as ImageData, 4);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(out.top).toHaveLength(4);
    const sum = out.top.reduce((s, p) => s + p.score, 0);
    expect(sum).toBeCloseTo(1, 4);
    expect(new Set(out.top.map((p) => p.labelId))).toEqual(new Set(soilLabels));
  });

  it("refuses a model whose output width does not match the labels", async () => {
    const wrong = tf.sequential({
      layers: [tf.layers.globalAveragePooling2d({ inputShape: [224, 224, 3] }), tf.layers.dense({ units: 3 })],
    });
    const c = createClassifier({
      loadTf: async () => tf,
      fetchJson: async (url) => ({ "metadata.json": meta, "labels.json": soilLabels })[url.split("/").pop()!] ?? null,
      loadModel: async () => wrong,
    });
    expect(await c.status("soil")).toMatchObject({ state: "error" });
  });
});
