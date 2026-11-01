#!/usr/bin/env node
/**
 * scripts/build-notebooks.mjs
 *
 * Generates packages/ml-models/{soil,disease}_classifier/train_colab.ipynb,
 * class_map.json and kernel-metadata.template.json from ONE shared pipeline
 * definition, so the two notebooks can never drift apart.
 *
 *   node scripts/build-notebooks.mjs
 *
 * This only writes JSON files. It does not train anything. The notebooks it
 * produces refuse to run anywhere except a Kaggle or Colab GPU runtime.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TASKS = {
  soil: {
    dir: "soil_classifier",
    title: "VIVA AI — soil type classifier",
    kernelSlug: "viva-ai-soil-classifier",
    datasetSlug: "ai4a-lab/comprehensive-soil-classification-datasets",
    datasetLicense: "CC BY-NC-SA 4.0 (licence shown on the Kaggle dataset page, checked 2026-11-01)",
    datasetNote:
      'Only the "Orignal-Dataset" folder is used (sic, the dataset\'s own spelling). "CyAUG-Dataset" contains augmented copies of the same photographs; using it would put near-copies of test images into training.',
    // app taxonomy id -> folder(s) inside the dataset (verified via the Kaggle file listing 2026-11-01:
    // Alluvial 52, Black 255, Laterite 219, Red 109 original images).
    classDirs: {
      alluvial: ["Orignal-Dataset/Alluvial_Soil"],
      black: ["Orignal-Dataset/Black_Soil"],
      laterite: ["Orignal-Dataset/Laterite_Soil"],
      red: ["Orignal-Dataset/Red_Soil"],
    },
    labelNames: {
      alluvial: { en: "Alluvial soil", ta: "வண்டல் மண்" },
      black: { en: "Black soil", ta: "கருமண்" },
      laterite: { en: "Laterite soil", ta: "லேட்டரைட் மண்" },
      red: { en: "Red soil", ta: "செம்மண்" },
    },
    minMacroF1: 0.7,
    minConfidence: 0.6,
    // Soil classes differ largely by colour, so colour jitter is kept very small.
    aug: { flip: true, rot90: true, brightness: 12, contrast: [0.9, 1.1], saturation: [0.95, 1.05], zoom: 0.85 },
    limitations: [
      "Trained on a few hundred photographs; the alluvial class has only ~50 originals, so its test metrics have wide uncertainty.",
      "Photos in the dataset are mostly close-ups of dry soil in daylight; wet soil, shadows, crop residue or mixed soils are out of distribution.",
      "Predicts visual soil category only. It does not measure pH, nutrients or texture; a soil test is still required.",
      "Dataset licence is non-commercial (CC BY-NC-SA 4.0).",
    ],
  },
  disease: {
    dir: "disease_classifier",
    title: "VIVA AI — tomato leaf condition classifier",
    kernelSlug: "viva-ai-disease-classifier",
    datasetSlug: "kaustubhb999/tomatoleaf",
    datasetLicense: "CC0: Public Domain (licence shown on the Kaggle dataset page, checked 2026-11-01)",
    datasetNote:
      "PlantVillage-derived tomato leaves, 10 classes, 1000 train + 100 val images per class. The upstream train/val folders are merged and re-split by near-duplicate groups because PlantVillage contains several photos of the same leaf.",
    classDirs: {
      tomato_bacterial_spot: ["tomato/train/Tomato___Bacterial_spot", "tomato/val/Tomato___Bacterial_spot"],
      tomato_early_blight: ["tomato/train/Tomato___Early_blight", "tomato/val/Tomato___Early_blight"],
      tomato_healthy: ["tomato/train/Tomato___healthy", "tomato/val/Tomato___healthy"],
      tomato_late_blight: ["tomato/train/Tomato___Late_blight", "tomato/val/Tomato___Late_blight"],
      tomato_leaf_mold: ["tomato/train/Tomato___Leaf_Mold", "tomato/val/Tomato___Leaf_Mold"],
      tomato_septoria_leaf_spot: ["tomato/train/Tomato___Septoria_leaf_spot", "tomato/val/Tomato___Septoria_leaf_spot"],
      tomato_spider_mites: [
        "tomato/train/Tomato___Spider_mites Two-spotted_spider_mite",
        "tomato/val/Tomato___Spider_mites Two-spotted_spider_mite",
      ],
      tomato_target_spot: ["tomato/train/Tomato___Target_Spot", "tomato/val/Tomato___Target_Spot"],
      tomato_mosaic_virus: ["tomato/train/Tomato___Tomato_mosaic_virus", "tomato/val/Tomato___Tomato_mosaic_virus"],
      tomato_yellow_leaf_curl_virus: [
        "tomato/train/Tomato___Tomato_Yellow_Leaf_Curl_Virus",
        "tomato/val/Tomato___Tomato_Yellow_Leaf_Curl_Virus",
      ],
    },
    labelNames: {
      tomato_bacterial_spot: { en: "Bacterial spot (tomato)", ta: "பாக்டீரியா இலைப்புள்ளி (தக்காளி)" },
      tomato_early_blight: { en: "Early blight (tomato)", ta: "முன் இலைக்கருகல் (தக்காளி)" },
      tomato_healthy: { en: "Healthy tomato leaf", ta: "ஆரோக்கியமான தக்காளி இலை" },
      tomato_late_blight: { en: "Late blight (tomato)", ta: "பின் இலைக்கருகல் (தக்காளி)" },
      tomato_leaf_mold: { en: "Leaf mould (tomato)", ta: "இலைப் பூஞ்சணம் (தக்காளி)" },
      tomato_septoria_leaf_spot: { en: "Septoria leaf spot (tomato)", ta: "செப்டோரியா இலைப்புள்ளி (தக்காளி)" },
      tomato_spider_mites: { en: "Spider mite damage (tomato)", ta: "சிலந்திப் பேன் தாக்குதல் (தக்காளி)" },
      tomato_target_spot: { en: "Target spot (tomato)", ta: "இலக்குப் புள்ளி நோய் (தக்காளி)" },
      tomato_mosaic_virus: { en: "Mosaic virus (tomato)", ta: "தேமல் வைரஸ் (தக்காளி)" },
      tomato_yellow_leaf_curl_virus: { en: "Yellow leaf curl virus (tomato)", ta: "மஞ்சள் இலைச்சுருள் வைரஸ் (தக்காளி)" },
    },
    minMacroF1: 0.9,
    minConfidence: 0.6,
    aug: { flip: true, rot90: true, brightness: 25, contrast: [0.8, 1.2], saturation: [0.85, 1.15], zoom: 0.8 },
    limitations: [
      "Tomato leaves only. Any other crop will be forced into one of the tomato classes; the app warns users about this.",
      "PlantVillage photos are single detached leaves on a plain background under controlled light. Accuracy on field photos with soil, hands or several leaves is expected to be substantially lower than the reported test metrics.",
      "Preliminary guidance only, not a diagnosis. Uncertain results should be confirmed by an agricultural extension officer.",
    ],
  },
};

const md = (s) => ({ cell_type: "markdown", metadata: {}, source: lines(s) });
const code = (s) => ({ cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: lines(s) });
function lines(s) {
  const t = s.replace(/^\n/, "").replace(/\s+$/, "");
  const parts = t.split("\n");
  return parts.map((l, i) => (i < parts.length - 1 ? `${l}\n` : l));
}

function cells(task, t) {
  const classMapJson = JSON.stringify(t.classDirs);
  return [
    md(`
# ${t.title}

Cloud-only training notebook for the VIVA AI \`${task}\` model. Generated by
\`scripts/build-notebooks.mjs\`; edit that file, not this notebook.

**Runs only on a Kaggle or Google Colab GPU runtime.** The runtime cell stops
immediately on any other machine or when no GPU is attached, so it can never
fall back to a laptop CPU.

Pipeline: dataset download → integrity checks (corrupt files, exact and
near-duplicates, cross-class conflicts) → leakage-resistant grouped
train/val/test split → MobileNetV2 transfer learning (frozen head, then
partial fine-tune) → held-out test evaluation → TF.js layers-model export →
artifact validation (shard sizes, sha256, output width and numerical parity
using the TF.js runtime itself) → \`metadata.json\` / \`labels.json\` /
\`evaluation.json\`.

Preprocessing mirrors the app exactly (\`src/shared/ui/ImageCapture.tsx\` and
\`src/lib/inference/classifier.ts\`): EXIF-orient, RGB, shrink so the long
side is at most 640 px, bilinear stretch to 224×224 with
\`align_corners=False, half_pixel_centers=False\` (TF.js \`resizeBilinear\`),
then \`x / 127.5 − 1\`.

Dataset: \`${t.datasetSlug}\`, licence ${t.datasetLicense}.
${t.datasetNote}

Outputs (Kaggle: \`/kaggle/working/artifacts\`, Colab: \`/content/artifacts\`
and Google Drive when mounted): \`${task}_model/\` with \`model.json\`, weight
shards, \`labels.json\`, \`metadata.json\`, \`evaluation.json\`,
\`confusion_matrix.png\`, plus \`run/\` with the training log, dataset report
and split manifest.
`),
    code(`
# 1. Configuration
import json
TASK = "${task}"
MODEL_NAME = "viva-${task}-mobilenetv2"
DATASET_SLUG = "${t.datasetSlug}"
DATASET_LICENSE = ${JSON.stringify(t.datasetLicense)}
CLASS_DIRS = json.loads(r'''${classMapJson}''')
LABEL_NAMES = json.loads(r'''${JSON.stringify(t.labelNames)}''')
LABELS = list(CLASS_DIRS.keys())          # output order of the model == labels.json
AUG = json.loads(r'''${JSON.stringify(t.aug)}''')
KNOWN_LIMITATIONS = json.loads(r'''${JSON.stringify(t.limitations)}''')

IMG = 224                 # model input size
CANVAS_MAX_SIDE = 640     # ImageCapture.tsx draws uploads into a canvas this size
MIN_SIDE = 64             # ImageCapture.tsx MIN_IMAGE_SIDE
BATCH = 32
HEAD_EPOCHS = 25
FT_EPOCHS = 25
FT_LAYERS = 40            # top MobileNetV2 layers unfrozen in phase 2 (BatchNorm stays frozen)
LR_HEAD = 1e-3
LR_FT = 1e-5
DROPOUT = 0.3
DHASH_THRESHOLD = 5       # Hamming distance (of 64) treated as the same photo
TEST_FOLDS = 7            # 1 of 7 groups-stratified folds -> ~14% test
VAL_FOLDS = 6             # 1 of 6 of the remainder        -> ~14% val
SEED = 42
MIN_MACRO_F1 = ${t.minMacroF1}       # below this the export is written with status "unverified" and the app will refuse it
MIN_CONFIDENCE = ${t.minConfidence}     # app asks for a retake below this top-1 softmax score
assert len(LABELS) >= 2 and set(LABELS) == set(LABEL_NAMES)
`),
    code(`
# 2. Runtime verification: cloud GPU only. Nothing below runs on a laptop.
import os, sys, shutil, subprocess, datetime, platform
ON_KAGGLE = os.path.isdir("/kaggle/working")
try:
    import google.colab  # noqa: F401
    ON_COLAB = True
except ImportError:
    ON_COLAB = False
PLATFORM = "kaggle" if ON_KAGGLE else "colab" if ON_COLAB else None
if PLATFORM is None:
    raise SystemExit("REFUSING TO RUN: this notebook trains only on Kaggle or Google Colab GPU runtimes.")

smi = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.free,driver_version",
                      "--format=csv,noheader"], capture_output=True, text=True)
if smi.returncode != 0 or not smi.stdout.strip():
    raise SystemExit("REFUSING TO RUN: no NVIDIA GPU attached. Enable a GPU accelerator and run again.")
GPU_INFO = smi.stdout.strip().splitlines()[0]
GPU_NAME = GPU_INFO.split(",")[0].strip()

WORK = "/kaggle/working" if ON_KAGGLE else "/content"
OUT = os.path.join(WORK, "artifacts")
MODEL_DIR = os.path.join(OUT, f"{TASK}_model")
RUN_DIR = os.path.join(OUT, "run")
CKPT_DIR = os.path.join(WORK, "checkpoints")
CACHE = "/tmp/viva_cache"   # resized copies; outside WORK so they are not saved as outputs
for d in (MODEL_DIR, RUN_DIR, CKPT_DIR, CACHE):
    os.makedirs(d, exist_ok=True)

RUN_ID = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
STARTED = datetime.datetime.utcnow()
disk = shutil.disk_usage(WORK)
print(f"platform={PLATFORM} python={platform.python_version()} gpu={GPU_INFO}")
print(f"disk free in {WORK}: {disk.free / 1e9:.1f} GB   run_id={RUN_ID}")
if disk.free < 5e9:
    raise SystemExit("REFUSING TO RUN: less than 5 GB free disk in the cloud runtime.")
`),
    code(`
# 3. Libraries. tf_keras (Keras 2) is used so the saved .h5 converts cleanly to a TF.js layers-model.
import importlib.metadata as im
os.environ["TF_USE_LEGACY_KERAS"] = "1"
tf_ver = im.version("tensorflow")
try:
    im.version("tf_keras")
except im.PackageNotFoundError:
    major_minor = ".".join(tf_ver.split(".")[:2])
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", f"tf_keras~={major_minor}.0", "kagglehub"], check=True)
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "kagglehub"], check=False)

import hashlib, random, re, zipfile
import numpy as np, pandas as pd
import tensorflow as tf
import tf_keras as keras
from PIL import Image, ImageOps
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, f1_score
from sklearn.utils.class_weight import compute_class_weight
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

gpus = tf.config.list_physical_devices("GPU")
if not gpus:
    raise SystemExit("REFUSING TO RUN: TensorFlow cannot see the GPU.")
for g in gpus:
    tf.config.experimental.set_memory_growth(g, True)
random.seed(SEED); np.random.seed(SEED); tf.random.set_seed(SEED)
print("tensorflow", tf.__version__, "| tf_keras", keras.__version__, "| GPUs", gpus)
`),
    code(`
# 4. Dataset acquisition (Kaggle mount or kagglehub download; public dataset, no credentials stored here)
def find_root(base, depth=4):
    first = [dirs[0] for dirs in CLASS_DIRS.values()]
    for cur, subdirs, _ in os.walk(base):
        if cur[len(base):].count(os.sep) > depth:
            subdirs[:] = []
            continue
        if all(os.path.isdir(os.path.join(cur, f)) for f in first):
            return cur
    return None

DATA_ROOT, DATASET_VERSION = None, "unknown"
try:
    import kagglehub
    path = kagglehub.dataset_download(DATASET_SLUG)
    m = re.search(r"versions/(\\d+)", path)
    DATASET_VERSION = m.group(1) if m else "kaggle-mounted"
    DATA_ROOT = find_root(path)
except Exception as e:
    print("kagglehub download failed:", repr(e))
if DATA_ROOT is None and os.path.isdir("/kaggle/input"):
    DATA_ROOT = find_root("/kaggle/input")
    DATASET_VERSION = "kaggle-mounted"
if DATA_ROOT is None:
    raise SystemExit(f"Dataset {DATASET_SLUG} not found or its folder structure changed. "
                     "Inspect it and update CLASS_DIRS in scripts/build-notebooks.mjs.")
print("dataset root:", DATA_ROOT, "| version:", DATASET_VERSION)
`),
    code(`
# 5. Integrity scan: unreadable / truncated / tiny images, EXIF orientation, hashing, app-equivalent resize cache
EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
records, corrupted, too_small, missing = [], [], [], []

def dhash64(im):
    g = np.asarray(im.convert("L").resize((9, 8), Image.BILINEAR), dtype=np.int16)
    bits = (g[:, 1:] > g[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)

for label, rels in CLASS_DIRS.items():
    for rel in rels:
        d = os.path.join(DATA_ROOT, rel)
        if not os.path.isdir(d):
            missing.append(rel); continue
        for name in sorted(os.listdir(d)):
            p = os.path.join(d, name)
            if os.path.splitext(name)[1].lower() not in EXTS or not os.path.isfile(p):
                continue
            try:
                with Image.open(p) as im:
                    im.verify()
                with Image.open(p) as im:
                    im = ImageOps.exif_transpose(im).convert("RGB")
                    w, h = im.size
                    if min(w, h) < MIN_SIDE:
                        too_small.append(p); continue
                    scale = min(1.0, CANVAS_MAX_SIDE / max(w, h))
                    if scale < 1.0:   # same as the app's canvas draw
                        im = im.resize((round(w * scale), round(h * scale)), Image.BILINEAR, reducing_gap=None)
                    sha = hashlib.sha256(open(p, "rb").read()).hexdigest()
                    cached = os.path.join(CACHE, f"{sha}.png")
                    if not os.path.exists(cached):
                        im.save(cached)
                    records.append(dict(rel=os.path.relpath(p, DATA_ROOT), label=label, sha256=sha,
                                        dhash=dhash64(im), width=w, height=h, cached=cached))
            except Exception as e:
                corrupted.append(dict(rel=os.path.relpath(p, DATA_ROOT), error=repr(e)))

if missing:
    raise SystemExit(f"Expected folders missing: {missing}")
df = pd.DataFrame(records)
print(f"readable={len(df)} corrupted={len(corrupted)} too_small={len(too_small)}")
print(df.groupby("label").size())
`),
    code(`
# 6. Duplicates and label conflicts. Exact copies (sha256) and near-copies (dHash) form groups;
#    a group never spans train/val/test, and a group seen under two labels is dropped entirely.
parent = list(range(len(df)))
def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]; i = parent[i]
    return i
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb: parent[rb] = ra

for _, idx in df.groupby("sha256").indices.items():
    for j in idx[1:]: union(idx[0], j)

hashes = np.array([int(h) for h in df["dhash"]], dtype=np.uint64)   # 64-bit unsigned; avoid pandas int64 overflow
popcount = getattr(np, "bitwise_count", None)
CHUNK = 256
for s in range(0, len(hashes), CHUNK):
    x = hashes[s:s + CHUNK, None] ^ hashes[None, :]
    dist = popcount(x) if popcount else np.unpackbits(x.view(np.uint8), axis=-1).reshape(x.shape[0], x.shape[1], -1).sum(-1)
    ii, jj = np.nonzero(dist <= DHASH_THRESHOLD)
    for i, j in zip(ii + s, jj):
        if i < j: union(int(i), int(j))

df["group"] = [find(i) for i in range(len(df))]
exact_dupes = int(len(df) - df["sha256"].nunique())
labels_per_group = df.groupby("group")["label"].nunique()
conflict_groups = set(labels_per_group[labels_per_group > 1].index)
conflicts = df[df["group"].isin(conflict_groups)]
df = df[~df["group"].isin(conflict_groups)]
df = df.drop_duplicates("sha256").reset_index(drop=True)   # keep one copy of each exact file
near_dupe_groups = int((df.groupby("group").size() > 1).sum())
print(f"exact duplicate files removed: {exact_dupes}")
print(f"near-duplicate groups kept together: {near_dupe_groups}")
print(f"images dropped for cross-class conflicts: {len(conflicts)}")
`),
    code(`
# 7. Class distribution and leakage-resistant grouped, stratified split
df["y"] = df["label"].map({l: i for i, l in enumerate(LABELS)})
sgkf = StratifiedGroupKFold(n_splits=TEST_FOLDS, shuffle=True, random_state=SEED)
trval_idx, test_idx = next(sgkf.split(df, df["y"], df["group"]))
trval = df.iloc[trval_idx].reset_index(drop=True)
test = df.iloc[test_idx].reset_index(drop=True)
sgkf2 = StratifiedGroupKFold(n_splits=VAL_FOLDS, shuffle=True, random_state=SEED)
tr_idx, va_idx = next(sgkf2.split(trval, trval["y"], trval["group"]))
train, val = trval.iloc[tr_idx].reset_index(drop=True), trval.iloc[va_idx].reset_index(drop=True)

assert not (set(train.group) & set(val.group)) and not (set(train.group) & set(test.group)) and not (set(val.group) & set(test.group))
assert not (set(train.sha256) & set(test.sha256)), "exact-duplicate leakage"
for name, part in (("train", train), ("val", val), ("test", test)):
    missing_cls = set(LABELS) - set(part.label)
    if missing_cls:
        raise SystemExit(f"{name} split has no images of {missing_cls}; dataset too small for a fair split")

dist = pd.DataFrame({n: p.label.value_counts() for n, p in (("train", train), ("val", val), ("test", test))}).loc[LABELS]
print(dist)
dist.plot.bar(figsize=(8, 4), title=f"{TASK}: images per class and split"); plt.tight_layout()
plt.savefig(os.path.join(RUN_DIR, "class_distribution.png"), dpi=120); plt.close()

pd.concat([train.assign(split="train"), val.assign(split="val"), test.assign(split="test")])[
    ["rel", "label", "split", "sha256", "group"]].to_csv(os.path.join(RUN_DIR, "split_manifest.csv"), index=False)
dataset_report = dict(dataset=DATASET_SLUG, version=DATASET_VERSION, license=DATASET_LICENSE,
                      readable=int(len(records)), corrupted=corrupted, too_small=len(too_small),
                      exact_duplicates_removed=exact_dupes, near_duplicate_groups=near_dupe_groups,
                      cross_class_conflicts_dropped=int(len(conflicts)),
                      split_counts={c: {k: int(v) for k, v in dist[c].items()} for c in dist.columns})
json.dump(dataset_report, open(os.path.join(RUN_DIR, "dataset_report.json"), "w"), indent=2)
`),
    code(`
# 8. tf.data input pipeline. Resize/normalise exactly like the app; augmentation on train only.
def load(path):
    img = tf.io.decode_png(tf.io.read_file(path), channels=3)
    img = tf.raw_ops.ResizeBilinear(images=tf.expand_dims(img, 0), size=[IMG, IMG],
                                    align_corners=False, half_pixel_centers=False)[0]   # == tf.image.resizeBilinear in TF.js
    return tf.cast(img, tf.float32)

def augment(img):
    if AUG.get("flip"):
        img = tf.image.random_flip_left_right(img); img = tf.image.random_flip_up_down(img)
    if AUG.get("rot90"):
        img = tf.image.rot90(img, k=tf.random.uniform([], 0, 4, dtype=tf.int32))
    z = AUG.get("zoom", 1.0)
    if z < 1.0:
        frac = tf.random.uniform([], z, 1.0)
        size = tf.cast(frac * IMG, tf.int32)
        img = tf.image.random_crop(img, [size, size, 3])
        img = tf.image.resize(img, [IMG, IMG])
    img = tf.image.random_brightness(img, AUG["brightness"])
    img = tf.image.random_contrast(img, *AUG["contrast"])
    img = tf.image.random_saturation(img, *AUG["saturation"])
    return tf.clip_by_value(img, 0.0, 255.0)

def normalise(img):
    return img / 127.5 - 1.0          # metadata input.preprocessing = "mobilenet_v2"

def make_ds(frame, training):
    ds = tf.data.Dataset.from_tensor_slices((frame["cached"].values, frame["y"].values.astype("int32")))
    if training:
        ds = ds.shuffle(len(frame), seed=SEED, reshuffle_each_iteration=True)
    ds = ds.map(lambda p, y: (load(p), y), num_parallel_calls=tf.data.AUTOTUNE)
    if training:
        ds = ds.map(lambda x, y: (augment(x), y), num_parallel_calls=tf.data.AUTOTUNE)
    return ds.map(lambda x, y: (normalise(x), y)).batch(BATCH).prefetch(tf.data.AUTOTUNE)

train_ds, val_ds, test_ds = make_ds(train, True), make_ds(val, False), make_ds(test, False)
class_weight = dict(enumerate(compute_class_weight("balanced", classes=np.arange(len(LABELS)), y=train["y"].values)))
print("class weights:", {LABELS[k]: round(v, 3) for k, v in class_weight.items()})
`),
    code(`
# 9. Model: MobileNetV2 (ImageNet) backbone, flat graph (no nested Model) for TF.js compatibility
inputs = keras.Input(shape=(IMG, IMG, 3), name="image")
base = keras.applications.MobileNetV2(input_tensor=inputs, include_top=False, weights="imagenet")
for layer in base.layers:
    layer.trainable = False
x = keras.layers.GlobalAveragePooling2D(name="pool")(base.output)
x = keras.layers.Dropout(DROPOUT, name="dropout")(x)
outputs = keras.layers.Dense(len(LABELS), activation="softmax", name="scores")(x)
model = keras.Model(inputs, outputs, name=MODEL_NAME)
print(f"params: {model.count_params():,}  output: {model.output_shape}")
`),
    code(`
# 10. Phase 1: train the classification head (backbone frozen)
def callbacks(phase):
    return [
        keras.callbacks.EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True),
        keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.3, patience=2, min_lr=1e-7),
        keras.callbacks.ModelCheckpoint(os.path.join(CKPT_DIR, f"best_{phase}.h5"), monitor="val_loss", save_best_only=True),
        keras.callbacks.CSVLogger(os.path.join(RUN_DIR, f"history_{phase}.csv")),
    ]
model.compile(optimizer=keras.optimizers.Adam(LR_HEAD), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
h1 = model.fit(train_ds, validation_data=val_ds, epochs=HEAD_EPOCHS, class_weight=class_weight, callbacks=callbacks("head"), verbose=2)
`),
    code(`
# 11. Phase 2: fine-tune the top of the backbone. BatchNorm layers stay frozen (inference statistics).
for layer in base.layers[-FT_LAYERS:]:
    if not isinstance(layer, keras.layers.BatchNormalization):
        layer.trainable = True
model.compile(optimizer=keras.optimizers.Adam(LR_FT), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
h2 = model.fit(train_ds, validation_data=val_ds, epochs=FT_EPOCHS, class_weight=class_weight, callbacks=callbacks("finetune"), verbose=2)
TRAIN_SECONDS = (datetime.datetime.utcnow() - STARTED).total_seconds()
epochs_run = len(h1.history["loss"]) + len(h2.history["loss"])
print(f"epochs run: {epochs_run}, wall time so far {TRAIN_SECONDS/60:.1f} min")
`),
    code(`
# 12. Held-out test evaluation (the test split was never used for training, early stopping or tuning)
def predict(ds):
    return model.predict(ds, verbose=0)
test_scores = predict(test_ds)
y_true, y_pred = test["y"].values, test_scores.argmax(1)
val_pred = predict(val_ds).argmax(1)
report = classification_report(y_true, y_pred, labels=list(range(len(LABELS))), target_names=LABELS, output_dict=True, zero_division=0)
cm = confusion_matrix(y_true, y_pred, labels=list(range(len(LABELS))))
acc, macro_f1 = accuracy_score(y_true, y_pred), f1_score(y_true, y_pred, average="macro")

rng = np.random.default_rng(SEED); boots = []
for _ in range(1000):
    i = rng.integers(0, len(y_true), len(y_true))
    boots.append((accuracy_score(y_true[i], y_pred[i]), f1_score(y_true[i], y_pred[i], average="macro")))
boots = np.array(boots)
ci = lambda col: [float(np.percentile(boots[:, col], 2.5)), float(np.percentile(boots[:, col], 97.5))]

top1 = test_scores.max(1)
low_conf_rate = float((top1 < MIN_CONFIDENCE).mean())
wrong = test[y_true != y_pred].assign(pred=[LABELS[k] for k in y_pred[y_true != y_pred]])[["rel", "label", "pred"]]
evaluation = dict(
    task=TASK, split="test", testSamples=int(len(y_true)), testAccuracy=float(acc), macroF1=float(macro_f1),
    accuracy95CI=ci(0), macroF1_95CI=ci(1),
    validationAccuracy=float(accuracy_score(val["y"].values, val_pred)), validationSamples=int(len(val)),
    perClass={l: {"precision": report[l]["precision"], "recall": report[l]["recall"], "f1": report[l]["f1-score"],
                  "support": int(report[l]["support"])} for l in LABELS},
    confusionMatrix={"labels": LABELS, "rows_true_cols_pred": cm.tolist()},
    fractionBelowMinConfidence=low_conf_rate, minConfidence=MIN_CONFIDENCE,
    misclassifiedExamples=wrong.head(50).to_dict("records"),
    note="Scores are uncalibrated softmax outputs. Metrics are on a held-out, group-disjoint test split of the same dataset; "
         "field performance on farmer photos has not been measured.")
print(json.dumps({k: evaluation[k] for k in ("testSamples", "testAccuracy", "macroF1", "accuracy95CI", "macroF1_95CI")}, indent=2))
print(pd.DataFrame(evaluation["perClass"]).T)

fig, ax = plt.subplots(figsize=(1.1 * len(LABELS) + 3, 1.1 * len(LABELS) + 2))
ax.imshow(cm, cmap="Greens"); ax.set_xticks(range(len(LABELS))); ax.set_yticks(range(len(LABELS)))
ax.set_xticklabels(LABELS, rotation=45, ha="right"); ax.set_yticklabels(LABELS)
for i in range(len(LABELS)):
    for j in range(len(LABELS)):
        ax.text(j, i, cm[i, j], ha="center", va="center", color="black")
ax.set_xlabel("predicted"); ax.set_ylabel("true"); ax.set_title(f"{TASK} test confusion matrix (n={len(y_true)})")
plt.tight_layout(); plt.savefig(os.path.join(MODEL_DIR, "confusion_matrix.png"), dpi=120); plt.close()
`),
    code(`
# 13. Export: Keras .h5, then TF.js layers-model conversion in an ISOLATED virtualenv
#     (tensorflowjs's pip dependencies must not touch the training environment).
H5 = os.path.join(CKPT_DIR, "final.h5")
model.save(H5, include_optimizer=False)
VENV = "/tmp/tfjs-venv"
def sh(cmd, check=True):
    print("$", " ".join(cmd)); r = subprocess.run(cmd, capture_output=True, text=True)
    print(r.stdout[-3000:], r.stderr[-3000:]);
    if check and r.returncode != 0: raise RuntimeError(f"command failed: {cmd[0]}")
    return r
if not os.path.exists(f"{VENV}/bin/python"):
    if sh([sys.executable, "-m", "venv", VENV], check=False).returncode != 0:
        sh([sys.executable, "-m", "pip", "install", "-q", "virtualenv"]); sh([sys.executable, "-m", "virtualenv", VENV])
if sh([f"{VENV}/bin/pip", "install", "-q", "tensorflowjs==4.22.0"], check=False).returncode != 0:
    # Fallback: skip optional heavy deps (jax/flax/TF-DF) that are not needed for keras -> layers-model.
    sh([f"{VENV}/bin/pip", "install", "-q", "--no-deps", "tensorflowjs==4.22.0"])
    sh([f"{VENV}/bin/pip", "install", "-q", "tensorflow-cpu>=2.13,<2.19", "tf_keras", "tensorflow_hub", "h5py", "packaging", "six", "importlib_resources"])
for f in os.listdir(MODEL_DIR):
    if f.endswith(".bin") or f == "model.json": os.remove(os.path.join(MODEL_DIR, f))
sh([f"{VENV}/bin/tensorflowjs_converter", "--input_format=keras", "--output_format=tfjs_layers_model",
    "--weight_shard_size_bytes=4194304", H5, MODEL_DIR])
print(sorted(os.listdir(MODEL_DIR)))
`),
    code(`
# 14. Artifact validation: format, shard sizes, sha256, output width, and numerical parity
#     between Keras and the TF.js runtime (@tensorflow/tfjs in Node, i.e. the same library the browser uses).
mj = json.load(open(os.path.join(MODEL_DIR, "model.json")))
problems = []
if mj.get("format") != "layers-model": problems.append(f"format is {mj.get('format')}")
DT = {"float32": 4, "int32": 4, "float16": 2, "uint8": 1, "bool": 1}
integrity = {}
for group in mj["weightsManifest"]:
    expected = sum(int(np.prod(w["shape"])) * DT[w.get("quantization", {}).get("dtype", w["dtype"])] for w in group["weights"])
    actual = 0
    for p in group["paths"]:
        fp = os.path.join(MODEL_DIR, p)
        if not os.path.exists(fp): problems.append(f"missing shard {p}"); continue
        actual += os.path.getsize(fp); integrity[p] = hashlib.sha256(open(fp, "rb").read()).hexdigest()
    if actual != expected: problems.append(f"shard bytes {actual} != manifest {expected}")
layers = mj["modelTopology"]["model_config"]["config"]["layers"]
if layers[-1]["config"].get("units") != len(LABELS): problems.append("output layer width != number of labels")

# Parity: run 32 test images through Keras and through TF.js on identical preprocessed tensors.
probe = np.concatenate([x for x, _ in test_ds.take(1)], 0)[:32]
keras_out = model.predict(probe, verbose=0)
np.save("/tmp/probe.npy", probe.astype("float32"))
node = shutil.which("node")
if node is None:
    sh([sys.executable, "-m", "pip", "install", "-q", "nodeenv"]); sh([sys.executable, "-m", "nodeenv", "--prebuilt", "-n", "20.18.0", "/tmp/nodeenv"])
    node = "/tmp/nodeenv/bin/node"
npm = os.path.join(os.path.dirname(node), "npm")
os.makedirs("/tmp/tfjs-check", exist_ok=True)
sh([npm, "install", "--prefix", "/tmp/tfjs-check", "--silent", "@tensorflow/tfjs@4.22.0"])
probe.astype("<f4").tofile("/tmp/probe.f32")
open("/tmp/tfjs-check/check.js", "w").write(r"""
const tf = require('@tensorflow/tfjs'); const fs = require('fs'); const path = require('path');
const dir = process.argv[2]; const n = +process.argv[3]; const s = +process.argv[4];
const mj = JSON.parse(fs.readFileSync(path.join(dir, 'model.json')));
const specs = mj.weightsManifest.flatMap(g => g.weights);
const buf = Buffer.concat(mj.weightsManifest.flatMap(g => g.paths.map(p => fs.readFileSync(path.join(dir, p)))));
(async () => {
  const model = await tf.loadLayersModel(tf.io.fromMemory({modelTopology: mj.modelTopology, weightSpecs: specs,
    weightData: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)}));
  const raw = fs.readFileSync('/tmp/probe.f32');
  const x = tf.tensor4d(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), [n, s, s, 3]);
  fs.writeFileSync('/tmp/tfjs_out.json', JSON.stringify(Array.from(await model.predict(x).data())));
})().catch(e => { console.error(e); process.exit(1); });
""")
sh([node, "/tmp/tfjs-check/check.js", MODEL_DIR, str(len(probe)), str(IMG)])
tfjs_out = np.array(json.load(open("/tmp/tfjs_out.json")), dtype=np.float32).reshape(keras_out.shape)
max_diff = float(np.abs(tfjs_out - keras_out).max())
argmax_agree = float((tfjs_out.argmax(1) == keras_out.argmax(1)).mean())
print(f"TF.js vs Keras: max |diff| = {max_diff:.2e}, argmax agreement = {argmax_agree:.3f}")
if max_diff > 1e-3 or argmax_agree < 1.0: problems.append(f"TF.js parity failed (max diff {max_diff}, agreement {argmax_agree})")
print("artifact problems:", problems or "none")
`),
    code(`
# 15. labels.json, evaluation.json, metadata.json. "validated" ONLY if every check passed and quality met the bar.
passed_quality = macro_f1 >= MIN_MACRO_F1
STATUS = "validated" if (not problems and passed_quality) else "unverified"
MODEL_VERSION = f"{TASK}-mnv2-{RUN_ID}"
json.dump(LABELS, open(os.path.join(MODEL_DIR, "labels.json"), "w"), ensure_ascii=False, indent=2)
json.dump(evaluation, open(os.path.join(MODEL_DIR, "evaluation.json"), "w"), ensure_ascii=False, indent=2)
metadata = {
    "schemaVersion": 1, "task": TASK, "status": STATUS, "modelVersion": MODEL_VERSION, "modelName": MODEL_NAME,
    "createdAt": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    "architecture": "MobileNetV2 (ImageNet weights, alpha 1.0) + GlobalAveragePooling + Dropout + Dense softmax",
    "input": {"height": IMG, "width": IMG, "channels": 3, "preprocessing": "mobilenet_v2"},
    "inputDetails": {"colorOrder": "RGB", "range": "[-1, 1] via x/127.5-1",
                     "resize": f"long side <= {CANVAS_MAX_SIDE} px, then bilinear stretch to {IMG}x{IMG} (align_corners=false, half_pixel_centers=false)"},
    "outputShape": [None, len(LABELS)],
    "labels": LABELS,
    "labelNames": LABEL_NAMES,
    "minConfidence": MIN_CONFIDENCE,
    "scoreType": "uncalibrated_softmax",
    "training": {"platform": PLATFORM, "accelerator": GPU_INFO, "dataset": f"kaggle:{DATASET_SLUG}",
                 "datasetVersion": DATASET_VERSION, "datasetLicense": DATASET_LICENSE,
                 "notebook": f"packages/ml-models/{TASK}_classifier/train_colab.ipynb", "runId": RUN_ID,
                 "tensorflow": tf.__version__, "durationSeconds": round(TRAIN_SECONDS), "epochs": epochs_run,
                 "config": {"batch": BATCH, "headEpochsMax": HEAD_EPOCHS, "fineTuneEpochsMax": FT_EPOCHS,
                            "fineTuneLayers": FT_LAYERS, "lrHead": LR_HEAD, "lrFineTune": LR_FT, "dropout": DROPOUT,
                            "augmentation": AUG, "classWeights": "balanced", "seed": SEED,
                            "split": "StratifiedGroupKFold by near-duplicate group (~72/14/14)"},
                 "splitCounts": dataset_report["split_counts"]},
    "evaluation": {"file": "evaluation.json", "testAccuracy": round(float(acc), 4), "macroF1": round(float(macro_f1), 4),
                   "testSamples": int(len(y_true))},
    "artifactChecks": {"problems": problems, "tfjsParityMaxAbsDiff": max_diff, "minMacroF1Required": MIN_MACRO_F1},
    "integrity": integrity,
    "knownLimitations": KNOWN_LIMITATIONS,
    "notes": None if STATUS == "validated" else
             ("Artifact checks failed: " + "; ".join(problems)) if problems else
             f"Macro F1 {macro_f1:.3f} is below the required {MIN_MACRO_F1}; the app will not use this model.",
}
if metadata["notes"] is None: del metadata["notes"]
json.dump(metadata, open(os.path.join(MODEL_DIR, "metadata.json"), "w"), ensure_ascii=False, indent=2)
print("STATUS:", STATUS, "| version:", MODEL_VERSION, "| test acc", round(acc, 4), "| macro F1", round(macro_f1, 4))
`),
    code(`
# 16. Package and store in the cloud (Kaggle keeps /kaggle/working as kernel output; Colab copies to Drive if mounted)
zip_path = os.path.join(OUT, f"{TASK}_model_{RUN_ID}.zip")
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    for root in (MODEL_DIR, RUN_DIR):
        for f in sorted(os.listdir(root)):
            z.write(os.path.join(root, f), os.path.join(os.path.basename(root), f))
print("artifact bundle:", zip_path, f"{os.path.getsize(zip_path)/1e6:.1f} MB")
if ON_COLAB:
    try:
        from google.colab import drive
        drive.mount("/content/drive")
        dest = f"/content/drive/MyDrive/viva-ai-models/{RUN_ID}"
        os.makedirs(dest, exist_ok=True); shutil.copy(zip_path, dest); shutil.copytree(CKPT_DIR, os.path.join(dest, "checkpoints"))
        print("copied to Google Drive:", dest)
    except Exception as e:
        print("Drive not mounted; download", zip_path, "from the Files panel.", repr(e))
# Large checkpoints are not part of the bundle; remove them from Kaggle output to keep it small.
if ON_KAGGLE:
    shutil.rmtree(CKPT_DIR, ignore_errors=True)
`),
    md(`
## Importing the result into the app

On the development machine (no training happens there):

\`\`\`bash
# Claude Code does this automatically via: npm run train:cloud -- ${task}
kaggle kernels output <user>/${t.kernelSlug} -p downloads/${task}
unzip downloads/${task}/artifacts/${task}_model_*.zip -d downloads/${task}/bundle
npm run model:import -- ${task} downloads/${task}/bundle/${task}_model
npm test && npm run build
\`\`\`

\`model:import\` re-checks metadata, label order, shard sizes, sha256 and the
output width, then swaps the folder into \`public/models/${task}_model\`
atomically and keeps the previous one in \`models-rollback/\`
(\`npm run model:rollback -- ${task}\` restores it).

A model whose metadata says \`"status": "unverified"\` is rejected by both the
import script and the app, which keeps showing **MODEL AWAITING CLOUD TRAINING**.
`),
  ];
}

for (const [task, t] of Object.entries(TASKS)) {
  const dir = join("packages", "ml-models", t.dir);
  mkdirSync(dir, { recursive: true });
  const nb = {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
      language_info: { name: "python" },
      accelerator: "GPU",
      colab: { provenance: [], gpuType: "T4" },
    },
    cells: cells(task, t),
  };
  writeFileSync(join(dir, "train_colab.ipynb"), JSON.stringify(nb, null, 1) + "\n");
  writeFileSync(join(dir, "class_map.json"), JSON.stringify(t.classDirs, null, 2) + "\n");
  writeFileSync(
    join(dir, "kernel-metadata.template.json"),
    JSON.stringify(
      {
        id: `{{KAGGLE_USERNAME}}/${t.kernelSlug}`,
        title: t.kernelSlug,
        code_file: "train_colab.ipynb",
        language: "python",
        kernel_type: "notebook",
        is_private: true,
        enable_gpu: true,
        enable_tpu: false,
        enable_internet: true,
        dataset_sources: [t.datasetSlug],
        competition_sources: [],
        kernel_sources: [],
        model_sources: [],
      },
      null,
      2
    ) + "\n"
  );
  console.log(`wrote ${dir}/train_colab.ipynb (${nb.cells.length} cells)`);
}
