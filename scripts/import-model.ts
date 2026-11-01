/**
 * scripts/import-model.ts — promote a cloud-trained TF.js export into the app.
 *
 *   npm run model:import -- soil    path/to/downloaded/soil_model
 *   npm run model:import -- disease path/to/downloaded/disease_model
 *   npm run model:rollback -- soil
 *
 * Import validates the folder with the same rules the app enforces at
 * runtime (src/lib/inference/metadata.ts) plus shard sizes, sha256 and the
 * output-layer width (src/lib/inference/artifact.ts). Only a folder that
 * passes every check is copied to public/models/<task>_model, and the swap
 * is atomic: the new files are staged next to the live folder, the live
 * folder is moved to models-rollback/<task>_model-<timestamp>, then the
 * staging folder is renamed into place. Rollback restores the newest backup.
 *
 * This script never trains, fine-tunes or re-exports a model.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkArtifact } from "../src/lib/inference/artifact";
import type { ModelTask } from "../src/domain/taxonomy";

const ROOT = process.cwd();
const PUBLIC_MODELS = join(ROOT, "public", "models");
const ROLLBACK = join(ROOT, "models-rollback");
const ARTIFACT_FILES = /^(model\.json|labels\.json|metadata\.json|evaluation\.json|group\d+-shard\d+of\d+\.bin|confusion_matrix\.png|README\.md)$/;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`cannot read ${path}: ${String(err)}`);
  }
}

function parseTask(raw: string | undefined): ModelTask {
  if (raw === "soil" || raw === "disease") return raw;
  fail('first argument must be "soil" or "disease"');
}

function importModel(task: ModelTask, source: string) {
  const src = resolve(source);
  if (!existsSync(src) || !statSync(src).isDirectory()) fail(`${src} is not a folder`);

  const names = readdirSync(src);
  const sizes: Record<string, number> = {};
  const sha256: Record<string, string> = {};
  for (const n of names) {
    const p = join(src, n);
    if (!statSync(p).isFile()) continue;
    sizes[n] = statSync(p).size;
    if (n.endsWith(".bin")) sha256[n] = createHash("sha256").update(readFileSync(p)).digest("hex");
  }
  for (const required of ["model.json", "labels.json", "metadata.json", "evaluation.json"]) {
    if (!(required in sizes)) fail(`${required} is missing from ${src}`);
  }

  const errors = checkArtifact(task, {
    modelJson: readJson(join(src, "model.json")),
    labels: readJson(join(src, "labels.json")),
    metadata: readJson(join(src, "metadata.json")),
    sizes,
    sha256,
  });
  if (errors.length) fail(`artifact rejected:\n  - ${errors.join("\n  - ")}`);

  const live = join(PUBLIC_MODELS, `${task}_model`);
  const staging = join(PUBLIC_MODELS, `.${task}_model.staging`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const n of Object.keys(sizes)) {
    if (ARTIFACT_FILES.test(n)) cpSync(join(src, n), join(staging, n));
  }

  if (existsSync(live)) {
    mkdirSync(ROLLBACK, { recursive: true });
    const backup = join(ROLLBACK, `${task}_model-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    renameSync(live, backup);
    console.log(`  previous model kept at ${backup}`);
  }
  renameSync(staging, live);
  const meta = readJson(join(live, "metadata.json")) as { modelVersion: string; evaluation: { testAccuracy: number; macroF1: number } };
  console.log(`✓ imported ${task} model ${meta.modelVersion} (test accuracy ${meta.evaluation.testAccuracy}, macro F1 ${meta.evaluation.macroF1})`);
}

function rollback(task: ModelTask) {
  if (!existsSync(ROLLBACK)) fail("no models-rollback folder: nothing to roll back to");
  const backups = readdirSync(ROLLBACK).filter((n) => n.startsWith(`${task}_model-`)).sort();
  const latest = backups.at(-1);
  if (!latest) fail(`no ${task} backups in ${ROLLBACK}`);
  const live = join(PUBLIC_MODELS, `${task}_model`);
  const discarded = join(ROLLBACK, `discarded-${task}_model-${Date.now()}`);
  if (existsSync(live)) renameSync(live, discarded);
  renameSync(join(ROLLBACK, latest), live);
  console.log(`✓ restored ${latest}; the replaced model was moved to ${discarded}`);
}

const [cmd, taskArg, source] = process.argv.slice(2);
if (cmd === "import") {
  if (!source) fail("usage: import-model.ts import <soil|disease> <folder>");
  importModel(parseTask(taskArg), source);
} else if (cmd === "rollback") {
  rollback(parseTask(taskArg));
} else {
  fail("usage: import-model.ts import <soil|disease> <folder> | rollback <soil|disease>");
}
