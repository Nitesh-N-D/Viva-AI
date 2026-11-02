// Regenerates every favicon / PWA icon from public/icons/icon-source-square.svg.
// Rasterises with the locally installed Chrome (headless, canvas.toDataURL),
// so no image library has to be installed. Output stays in public/.
//   node scripts/build-icons.mjs            (CHROME=path overrides the browser)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = path.join(root, "public", "icons");
const tmpDir = path.join(root, "tmp", "icons");
fs.mkdirSync(tmpDir, { recursive: true });

const source = fs.readFileSync(path.join(iconsDir, "icon-source-square.svg"), "utf8");
const defs = source.match(/<defs>[\s\S]*?<\/defs>/)[0];
const mark = source.match(/<g id="mark">[\s\S]*?<\/g>/)[0];
const svg = (body) => `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">${defs}${body}</svg>`;

// Rounded tile for browser tabs / "any" purpose icons (transparent corners).
const rounded = svg(`<rect width="512" height="512" rx="104" fill="url(#bg)"/>${mark}`);
// Full-bleed square: iOS applies its own mask and dislikes transparency.
const square = source;
// Maskable: content shrunk into the 80% safe zone so any mask shape keeps it.
const maskable = svg(`<rect width="512" height="512" fill="url(#bg)"/><g transform="translate(256 262) scale(0.74) translate(-256 -266)">${mark}</g>`);

const jobs = [
  ["icon-16.png", rounded, 16],
  ["icon-32.png", rounded, 32],
  ["icon-48.png", rounded, 48],
  ["icon-192.png", rounded, 192],
  ["icon-512.png", rounded, 512],
  ["icon-maskable-512.png", maskable, 512],
  ["icon-180.png", square, 180],
  ["apple-touch-icon.png", square, 180],
];

fs.writeFileSync(path.join(iconsDir, "icon-192.svg"), rounded.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="192" height="192"') + "\n");
fs.writeFileSync(path.join(iconsDir, "icon-512.svg"), rounded + "\n");

const html = `<!doctype html><meta charset="utf-8"><pre id="out"></pre><script>
const jobs = ${JSON.stringify(jobs)};
(async () => {
  const out = {};
  for (const [name, src, size] of jobs) {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, size, size);
    out[name] = c.toDataURL("image/png");
  }
  document.getElementById("out").textContent = JSON.stringify(out);
})().catch((e) => { document.getElementById("out").textContent = "ERROR " + e; });
</script>`;
const page = path.join(tmpDir, "render.html");
fs.writeFileSync(page, html);

const chrome = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const dom = execFileSync(chrome, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--allow-file-access-from-files",
  `--user-data-dir=${path.join(tmpDir, "profile")}`, "--virtual-time-budget=5000",
  "--dump-dom", pathToFileURL(page).href,
], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const text = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/)?.[1]?.replace(/&quot;/g, '"').replace(/&amp;/g, "&") ?? "";
if (!text.startsWith("{")) throw new Error("Icon render failed: " + text.slice(0, 200));
const pngs = {};
for (const [name, url] of Object.entries(JSON.parse(text))) {
  pngs[name] = Buffer.from(url.split(",")[1], "base64");
  fs.writeFileSync(path.join(iconsDir, name), pngs[name]);
  console.log(`${name}  ${pngs[name].length} bytes`);
}

// favicon.ico with PNG-compressed 16/32/48 entries (supported by all current browsers).
const entries = [["icon-16.png", 16], ["icon-32.png", 32], ["icon-48.png", 48]];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = 6 + 16 * entries.length;
const dir = [];
for (const [name, size] of entries) {
  const d = Buffer.alloc(16);
  d.writeUInt8(size, 0); d.writeUInt8(size, 1); d.writeUInt8(0, 2); d.writeUInt8(0, 3);
  d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
  d.writeUInt32LE(pngs[name].length, 8); d.writeUInt32LE(offset, 12);
  offset += pngs[name].length;
  dir.push(d);
}
const ico = Buffer.concat([header, ...dir, ...entries.map(([n]) => pngs[n])]);
fs.writeFileSync(path.join(root, "public", "favicon.ico"), ico);
console.log(`favicon.ico  ${ico.length} bytes`);
