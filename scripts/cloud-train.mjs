#!/usr/bin/env node
/**
 * scripts/cloud-train.mjs — run a training notebook on a Kaggle GPU, wait for
 * it, download the artifacts and hand them to `model:import`.
 *
 *   npm run train:cloud -- soil
 *   npm run train:cloud -- disease
 *   npm run train:cloud -- soil --no-push     # only poll + download an existing run
 *
 * ALL TRAINING HAPPENS ON KAGGLE. This script pushes a notebook, polls its
 * status and downloads its output; it never imports TensorFlow or touches a
 * dataset locally. The notebook itself refuses to run without a cloud GPU.
 *
 * Requirements (one-time, done by the repo owner, never committed):
 *   - pip install kaggle      (the official CLI)
 *   - a Kaggle API token in ~/.kaggle/kaggle.json, or KAGGLE_USERNAME +
 *     KAGGLE_KEY in the environment.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TASKS = { soil: "soil_classifier", disease: "disease_classifier" };
const POLL_SECONDS = 60;
const MAX_HOURS = 9; // Kaggle's own session limit is 12 h on GPU

const [task, ...flags] = process.argv.slice(2);
if (!(task in TASKS)) die('usage: npm run train:cloud -- <soil|disease> [--no-push]');
const noPush = flags.includes("--no-push");

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function kaggleUser() {
  if (process.env.KAGGLE_USERNAME && process.env.KAGGLE_KEY) return process.env.KAGGLE_USERNAME;
  const file = join(homedir(), ".kaggle", "kaggle.json");
  if (!existsSync(file)) {
    die(
      "No Kaggle API token found. Create one at https://www.kaggle.com/settings (API → Create New Token) and save it as " +
        `${file}, or set KAGGLE_USERNAME and KAGGLE_KEY. The token is never copied into this repository.`
    );
  }
  const { username } = JSON.parse(readFileSync(file, "utf8")); // the key is left for the kaggle CLI to read
  if (!username) die(`${file} has no username field`);
  return username;
}

function kaggle(args, { capture = false } = {}) {
  const r = spawnSync("kaggle", args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit", shell: process.platform === "win32" });
  if (r.error) die(`could not run the kaggle CLI (${r.error.message}). Install it with: pip install kaggle`);
  return r;
}

const user = kaggleUser();
const nbDir = join("packages", "ml-models", TASKS[task]);
const template = JSON.parse(readFileSync(join(nbDir, "kernel-metadata.template.json"), "utf8"));
const kernelId = template.id.replace("{{KAGGLE_USERNAME}}", user);

if (!noPush) {
  const stage = mkdtempSync(join(tmpdir(), `viva-kernel-${task}-`));
  cpSync(join(nbDir, "train_colab.ipynb"), join(stage, "train_colab.ipynb"));
  writeFileSync(join(stage, "kernel-metadata.json"), JSON.stringify({ ...template, id: kernelId }, null, 2));
  console.log(`→ pushing ${kernelId} (Kaggle GPU, private)`);
  const push = kaggle(["kernels", "push", "-p", stage]);
  rmSync(stage, { recursive: true, force: true });
  if (push.status !== 0) die("kaggle kernels push failed (see output above)");
}

const deadline = Date.now() + MAX_HOURS * 3600_000;
let status = "";
while (Date.now() < deadline) {
  const r = kaggle(["kernels", "status", kernelId], { capture: true });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  status = (text.match(/status "?([A-Za-z_.]+)"?/)?.[1] ?? text).toLowerCase();
  console.log(`  ${new Date().toISOString()}  ${status}`);
  if (/complete|error|cancel/.test(status)) break;
  await new Promise((res) => setTimeout(res, POLL_SECONDS * 1000));
}

const outDir = resolve("downloads", task, new Date().toISOString().replace(/[:.]/g, "-"));
console.log(`→ downloading kernel output to ${outDir}`);
if (kaggle(["kernels", "output", kernelId, "-p", outDir]).status !== 0) die("kaggle kernels output failed");
if (!/complete/.test(status)) die(`kernel finished with status "${status}". Logs are in ${outDir}; nothing was imported.`);

function findModelDir(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) continue;
    if (name === `${task}_model` && existsSync(join(p, "metadata.json"))) return p;
    const found = findModelDir(p);
    if (found) return found;
  }
  return null;
}
const modelDir = findModelDir(outDir);
if (!modelDir) die(`no ${task}_model/metadata.json in the kernel output (${outDir})`);

const meta = JSON.parse(readFileSync(join(modelDir, "metadata.json"), "utf8"));
console.log(`  status=${meta.status} testAccuracy=${meta.evaluation?.testAccuracy} macroF1=${meta.evaluation?.macroF1}`);
if (meta.status !== "validated") die(`the run produced an UNVERIFIED model: ${meta.notes ?? "see metadata.json"}. Not importing.`);

const imp = spawnSync("npx", ["vite-node", "scripts/import-model.ts", "import", task, modelDir], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(imp.status ?? 1);
