/**
 * lib/inference/classifier.ts
 *
 * Metadata-driven image classification for the soil and disease models.
 *
 *  - The model folder must contain metadata.json + labels.json + model.json.
 *    Class order comes from labels.json, never from code.
 *  - Only `status: "validated"` models are run. Anything else reports
 *    "awaiting_training" and the UI says so; there is no fake fallback
 *    classifier.
 *  - TensorFlow.js is imported lazily so the ~1 MB library only downloads
 *    when a scan screen actually needs it.
 *  - All intermediate tensors are created inside tf.tidy.
 */
import type * as TF from "@tensorflow/tfjs";
import type { ModelTask } from "../../domain/taxonomy";
import { validateModelMetadata, type ModelMetadata, type Preprocessing } from "./metadata";

export interface Prediction {
  labelId: string;
  score: number;
}

export type ModelStatus =
  | { state: "ready"; metadata: ModelMetadata }
  | { state: "awaiting_training"; reason: string }
  | { state: "error"; reason: string };

export type ClassifyOutcome =
  | {
      status: "ok";
      top: Prediction[];
      /** false when the top score is below metadata.minConfidence. */
      confident: boolean;
      metadata: ModelMetadata;
    }
  | { status: "awaiting_training"; reason: string }
  | { status: "error"; reason: string };

type TfModule = typeof TF;

export interface ModelIO {
  loadTf(): Promise<TfModule>;
  fetchJson(url: string): Promise<unknown | null>;
  loadModel(tf: TfModule, url: string): Promise<TF.LayersModel>;
}

export const MODEL_BASE: Record<ModelTask, string> = {
  soil: "/models/soil_model",
  disease: "/models/disease_model",
};

const browserIO: ModelIO = {
  loadTf: () => import("@tensorflow/tfjs"),
  async fetchJson(url) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  },
  loadModel: (tf, url) => tf.loadLayersModel(url),
};

/** Sorted top-k predictions from a raw score vector. Pure; exported for tests. */
export function topK(scores: ArrayLike<number>, labels: readonly string[], k: number): Prediction[] {
  if (scores.length !== labels.length) {
    throw new Error(`model produced ${scores.length} scores but labels.json lists ${labels.length} classes`);
  }
  return Array.from(scores, (score, i) => ({ labelId: labels[i], score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, k));
}

/** Resize + normalise exactly as the training notebook did. */
export function preprocess(
  tf: TfModule,
  pixels: TF.Tensor3D,
  input: { height: number; width: number; preprocessing: Preprocessing }
): TF.Tensor4D {
  return tf.tidy(() => {
    const resized = tf.image.resizeBilinear(pixels.toFloat(), [input.height, input.width]);
    // mobilenet_v2.preprocess_input maps [0,255] -> [-1,1].
    const scaled = input.preprocessing === "mobilenet_v2" ? resized.div(127.5).sub(1) : resized.div(255);
    return scaled.expandDims(0) as TF.Tensor4D;
  });
}

export function createClassifier(io: ModelIO = browserIO) {
  const loaded = new Map<ModelTask, Promise<{ status: ModelStatus; model?: TF.LayersModel; tf?: TfModule }>>();

  async function load(task: ModelTask) {
    const base = MODEL_BASE[task];
    const metadata = await io.fetchJson(`${base}/metadata.json`);
    if (metadata === null) {
      return { status: { state: "awaiting_training", reason: "no metadata.json found" } as ModelStatus };
    }
    const labels = await io.fetchJson(`${base}/labels.json`);
    const errors = validateModelMetadata(metadata, task, labels ?? undefined);
    if (labels === null) errors.push("labels.json is missing");
    if (errors.length) {
      return { status: { state: "error", reason: errors.join("; ") } as ModelStatus };
    }
    const meta = metadata as ModelMetadata;
    if (meta.status !== "validated") {
      return {
        status: {
          state: "awaiting_training",
          reason: meta.notes ?? "model artifact has not been validated by a cloud training run",
        } as ModelStatus,
      };
    }
    try {
      const tf = await io.loadTf();
      const model = await io.loadModel(tf, `${base}/model.json`);
      const outShape = model.outputs[0].shape as (number | null)[];
      const outUnits = outShape[outShape.length - 1];
      if (outUnits !== meta.labels.length) {
        model.dispose();
        return {
          status: {
            state: "error",
            reason: `model has ${outUnits} outputs but metadata lists ${meta.labels.length} labels`,
          } as ModelStatus,
        };
      }
      return { status: { state: "ready", metadata: meta } as ModelStatus, model, tf };
    } catch (err) {
      return { status: { state: "error", reason: `model failed to load: ${String(err)}` } as ModelStatus };
    }
  }

  function get(task: ModelTask) {
    let p = loaded.get(task);
    if (!p) {
      p = load(task);
      loaded.set(task, p);
    }
    return p;
  }

  return {
    async status(task: ModelTask): Promise<ModelStatus> {
      return (await get(task)).status;
    },

    async classify(task: ModelTask, image: ImageData | HTMLCanvasElement, k = 3): Promise<ClassifyOutcome> {
      const { status, model, tf } = await get(task);
      if (status.state === "awaiting_training") return { status: "awaiting_training", reason: status.reason };
      if (status.state === "error" || !model || !tf) {
        return { status: "error", reason: status.state === "error" ? status.reason : "model unavailable" };
      }
      const meta = status.metadata;
      const output = tf.tidy(() => {
        const pixels = tf.browser.fromPixels(image);
        const batch = preprocess(tf, pixels, meta.input);
        return model.predict(batch) as TF.Tensor;
      });
      try {
        const scores = await output.data();
        const top = topK(scores, meta.labels, k);
        return { status: "ok", top, confident: top[0].score >= meta.minConfidence, metadata: meta };
      } finally {
        output.dispose();
      }
    },
  };
}

export const classifier = createClassifier();
