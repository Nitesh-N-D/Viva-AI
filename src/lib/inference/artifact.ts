/**
 * lib/inference/artifact.ts
 *
 * Structural integrity checks for an exported TF.js layers-model folder
 * (model.json + weight shards + labels.json + metadata.json). Pure: the
 * caller supplies file contents, so the same code runs in unit tests and
 * in `scripts/import-model.ts` (Node) before a model is promoted into
 * public/models/. Nothing here trains or modifies a model.
 */
import { validateModelMetadata } from "./metadata";
import type { ModelTask } from "../../domain/taxonomy";

const DTYPE_BYTES: Record<string, number> = { float32: 4, int32: 4, bool: 1, float16: 2, uint8: 1 };

export interface WeightEntry {
  name: string;
  shape: number[];
  dtype: string;
  quantization?: { dtype: string };
}

export interface ArtifactFiles {
  modelJson: unknown;
  labels: unknown;
  metadata: unknown;
  /** Byte length of every file present in the folder, keyed by file name. */
  sizes: Record<string, number>;
  /** sha256 hex of every shard, keyed by file name (optional). */
  sha256?: Record<string, string>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function entryBytes(w: WeightEntry): number {
  const dtype = w.quantization?.dtype ?? w.dtype;
  const per = DTYPE_BYTES[dtype];
  if (per === undefined) return NaN;
  return w.shape.reduce((a, b) => a * b, 1) * per;
}

/** Units of the final Dense layer in a layers-model topology, or null. */
export function finalUnits(modelJson: unknown): number | null {
  if (!isObject(modelJson)) return null;
  const topo = modelJson.modelTopology;
  if (!isObject(topo)) return null;
  const cfg = isObject(topo.model_config) ? topo.model_config : topo;
  const inner = isObject(cfg.config) ? cfg.config : null;
  const layers = inner && Array.isArray(inner.layers) ? inner.layers : null;
  if (!layers || layers.length === 0) return null;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (isObject(layer) && isObject(layer.config) && typeof layer.config.units === "number") {
      return layer.config.units;
    }
  }
  return null;
}

/**
 * Returns a list of problems; empty means the folder is safe to promote.
 * Checks metadata (same rules the app enforces at runtime), label order,
 * model format, every shard listed in the manifest exists with exactly the
 * byte length its weight specs imply, optional sha256 against
 * `metadata.integrity`, and that the output layer width equals the label count.
 */
export function checkArtifact(task: ModelTask, files: ArtifactFiles): string[] {
  const errors = validateModelMetadata(files.metadata, task, files.labels);
  const meta = isObject(files.metadata) ? files.metadata : {};
  if (meta.status !== "validated") errors.push('metadata.status must be "validated" to import');

  const mj = files.modelJson;
  if (!isObject(mj)) return [...errors, "model.json is not a JSON object"];
  if (mj.format !== "layers-model") errors.push('model.json format must be "layers-model" (the app uses tf.loadLayersModel)');

  const manifest = mj.weightsManifest;
  if (!Array.isArray(manifest) || manifest.length === 0) {
    errors.push("model.json has no weightsManifest");
  } else {
    for (const group of manifest) {
      if (!isObject(group) || !Array.isArray(group.paths) || !Array.isArray(group.weights)) {
        errors.push("malformed weightsManifest group");
        continue;
      }
      const paths = group.paths as string[];
      const expected = (group.weights as WeightEntry[]).reduce((sum, w) => sum + entryBytes(w), 0);
      if (!Number.isFinite(expected)) errors.push("weightsManifest contains an unknown dtype");
      let actual = 0;
      for (const p of paths) {
        if (p.includes("/") || p.includes("\\") || p.startsWith(".")) {
          errors.push(`shard path not allowed: ${p}`);
          continue;
        }
        const size = files.sizes[p];
        if (size === undefined) errors.push(`missing weight shard: ${p}`);
        else actual += size;
      }
      if (Number.isFinite(expected) && actual !== expected && !errors.some((e) => e.startsWith("missing weight shard"))) {
        errors.push(`weight shards hold ${actual} bytes but the manifest describes ${expected}`);
      }
    }
  }

  const integrity = meta.integrity;
  if (isObject(integrity) && files.sha256) {
    for (const [name, hash] of Object.entries(integrity)) {
      const got = files.sha256[name];
      if (got === undefined) errors.push(`integrity lists ${name} but it is missing`);
      else if (got !== hash) errors.push(`sha256 mismatch for ${name}`);
    }
  }

  const units = finalUnits(mj);
  const labels = Array.isArray(files.labels) ? files.labels.length : -1;
  if (units === null) errors.push("could not find the output layer width in model.json");
  else if (units !== labels) errors.push(`output layer has ${units} units but labels.json lists ${labels} classes`);

  return errors;
}
