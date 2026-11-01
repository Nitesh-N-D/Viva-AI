/**
 * lib/inference/metadata.ts
 *
 * Schema + validator for `public/models/<task>_model/metadata.json`. The
 * training notebooks (packages/ml-models) write this file next to the
 * TF.js export. The app refuses to run any model whose metadata is
 * missing, malformed, inconsistent with labels.json, or not marked
 * `status: "validated"` — so an artifact of unknown provenance can never
 * silently produce predictions.
 */
import { TAXONOMY, type ModelTask } from "../../domain/taxonomy";

export type Preprocessing = "mobilenet_v2" | "rescale_0_1";

export interface ModelMetadata {
  schemaVersion: 1;
  task: ModelTask;
  status: "validated" | "unverified";
  modelVersion: string;
  createdAt: string;
  architecture: string;
  input: { height: number; width: number; channels: 3; preprocessing: Preprocessing };
  labels: string[];
  /** Below this top-1 score the UI asks for a retake instead of showing a class. */
  minConfidence: number;
  /** Softmax outputs are not calibrated probabilities unless calibration was run. */
  scoreType: "uncalibrated_softmax" | "calibrated_probability";
  training?: {
    platform: "kaggle" | "colab";
    accelerator: string;
    dataset: string;
    notebook: string;
  };
  evaluation?: {
    file: string;
    testAccuracy: number;
    macroF1: number;
    testSamples: number;
  };
  notes?: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isUnitInterval(v: unknown): v is number {
  return typeof v === "number" && v >= 0 && v <= 1;
}

/**
 * Returns a list of human-readable problems; an empty list means the
 * metadata is structurally valid. `expectedTask` guards against a soil
 * model being dropped into the disease folder (the two legacy artifacts
 * in this repo share most of their weights, so that mistake is easy).
 */
export function validateModelMetadata(raw: unknown, expectedTask: ModelTask, labelsFile?: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(raw)) return ["metadata is not a JSON object"];

  if (raw.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (raw.task !== expectedTask) errors.push(`task must be "${expectedTask}"`);
  if (raw.status !== "validated" && raw.status !== "unverified") errors.push('status must be "validated" or "unverified"');
  if (typeof raw.modelVersion !== "string" || !raw.modelVersion) errors.push("modelVersion is required");
  if (typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) errors.push("createdAt must be an ISO date");
  if (typeof raw.architecture !== "string") errors.push("architecture is required");

  const input = raw.input;
  if (!isObject(input)) {
    errors.push("input is required");
  } else {
    if (!isPositiveInt(input.height) || !isPositiveInt(input.width)) errors.push("input.height/width must be positive integers");
    if (input.channels !== 3) errors.push("input.channels must be 3");
    if (input.preprocessing !== "mobilenet_v2" && input.preprocessing !== "rescale_0_1") {
      errors.push('input.preprocessing must be "mobilenet_v2" or "rescale_0_1"');
    }
  }

  const known = new Set(TAXONOMY[expectedTask].map((e) => e.id));
  if (!Array.isArray(raw.labels) || raw.labels.length < 2) {
    errors.push("labels must list at least two class ids");
  } else {
    const labels = raw.labels as unknown[];
    if (labels.some((l) => typeof l !== "string")) errors.push("labels must be strings");
    if (new Set(labels).size !== labels.length) errors.push("labels must be unique");
    const unknown = labels.filter((l) => typeof l === "string" && !known.has(l));
    if (unknown.length) errors.push(`labels not in app taxonomy: ${unknown.join(", ")}`);
    if (labelsFile !== undefined) {
      if (!Array.isArray(labelsFile) || JSON.stringify(labelsFile) !== JSON.stringify(labels)) {
        errors.push("labels.json does not match metadata.labels (order matters)");
      }
    }
  }

  if (!isUnitInterval(raw.minConfidence)) errors.push("minConfidence must be between 0 and 1");
  if (raw.scoreType !== "uncalibrated_softmax" && raw.scoreType !== "calibrated_probability") {
    errors.push('scoreType must be "uncalibrated_softmax" or "calibrated_probability"');
  }

  if (raw.status === "validated") {
    const ev = raw.evaluation;
    if (!isObject(ev)) {
      errors.push("a validated model must include evaluation results");
    } else if (!isUnitInterval(ev.testAccuracy) || !isUnitInterval(ev.macroF1) || !isPositiveInt(ev.testSamples)) {
      errors.push("evaluation must have testAccuracy, macroF1 (0..1) and testSamples (>0)");
    }
    if (!isObject(raw.training)) errors.push("a validated model must record its training run");
  }

  return errors;
}
