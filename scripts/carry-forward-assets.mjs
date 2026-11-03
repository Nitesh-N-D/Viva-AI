#!/usr/bin/env node
/**
 * scripts/carry-forward-assets.mjs — keep the previous release's hashed
 * chunks available after a deploy.
 *
 * Firebase Hosting replaces the whole file set on every deploy, so the hashed
 * JS/CSS files of the release that is live right now disappear the moment
 * the new one goes out. Any tab still running that release (an open page, or
 * a service worker that has not switched yet) then fails with "Failed to
 * fetch dynamically imported module" as soon as it opens another screen.
 *
 * Run after `npm run build` and before deploying: it reads the asset list of
 * the live release (its index.html and the precache manifest inside sw.js)
 * and copies every /assets/* file that the new build does not contain into
 * dist/assets. Hashed names never collide, so nothing in the new build is
 * overwritten. Only one release back is kept (the live sw.js lists only its
 * own files), so dist does not grow without bound.
 *
 * Never fails the deploy: on any network problem it warns and exits 0.
 *
 * Usage: node scripts/carry-forward-assets.mjs [siteUrl] [distDir]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const site = (process.argv[2] ?? process.env.LIVE_SITE_URL ?? "https://viva-ai-2cc88.web.app").replace(/\/$/, "");
const dist = process.argv[3] ?? "dist";
const MAX_FILES = 400;
const MAX_BYTES = 8 * 1024 * 1024;
const ASSET_RE = /\/?assets\/[A-Za-z0-9_.-]+\.(?:js|css)\b/g;

async function get(path) {
  const res = await fetch(site + path, { signal: AbortSignal.timeout(20_000), headers: { "cache-control": "no-cache" } });
  return res;
}

export function assetPaths(text) {
  const out = new Set();
  for (const m of text.matchAll(ASSET_RE)) out.add("/" + m[0].replace(/^\//, ""));
  return [...out];
}

async function main() {
  if (!existsSync(join(dist, "index.html"))) {
    console.error(`carry-forward: ${dist}/index.html not found; run the build first.`);
    process.exit(1);
  }
  let listing = "";
  for (const p of ["/index.html", "/sw.js"]) {
    try {
      const res = await get(p);
      if (res.ok) listing += "\n" + (await res.text());
    } catch (e) {
      console.warn(`::warning::carry-forward: could not read live ${p} (${e?.name ?? "error"}); skipping.`);
    }
  }
  const paths = assetPaths(listing).slice(0, MAX_FILES);
  let copied = 0;
  let present = 0;
  let skipped = 0;
  mkdirSync(join(dist, "assets"), { recursive: true });
  for (const p of paths) {
    const target = join(dist, p);
    if (existsSync(target)) {
      present++;
      continue;
    }
    try {
      const res = await get(p);
      const type = res.headers.get("content-type") ?? "";
      // A missing file used to come back as index.html with status 200: never copy HTML as a chunk.
      if (!res.ok || !/javascript|css/.test(type)) {
        skipped++;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) {
        skipped++;
        continue;
      }
      writeFileSync(target, buf);
      copied++;
    } catch {
      skipped++;
    }
  }
  console.log(`carry-forward: ${paths.length} live assets, ${present} already in the new build, ${copied} carried forward, ${skipped} skipped.`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("carry-forward-assets.mjs")) {
  main().catch((e) => {
    console.warn(`::warning::carry-forward failed (${e?.name ?? "error"}); deploying the new build only.`);
  });
}
