import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";
import { CACHE_TTL_MS, RateLimiter, TtlCache, handleMandiProxy } from "./src/server/mandiProxy";
import type { MandiProxyBody } from "./src/lib/mandiQuery";

/**
 * Server-side mandi key. AGMARKNET_API_KEY has no VITE_ prefix, so Vite never
 * exposes it to client code. A legacy VITE_AGMARKNET_API_KEY in .env is still
 * accepted here for the dev/preview proxy only; client code no longer reads it.
 */
function mandiKey(env: Record<string, string>): string | undefined {
  return env.AGMARKNET_API_KEY || env.VITE_AGMARKNET_API_KEY || undefined;
}

/** Serves /api-mandi/prices from the shared proxy handler in `vite` and `vite preview`. */
function mandiDevProxy(apiKey: string | undefined): Plugin {
  const cache = new TtlCache<MandiProxyBody>(CACHE_TTL_MS);
  const limiter = new RateLimiter();
  const middleware = (req: import("http").IncomingMessage, res: import("http").ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api-mandi/prices") return next();
    handleMandiProxy(url.searchParams, req.socket.remoteAddress ?? "local", {
      apiKey,
      fetch: (u, init) => fetch(u, init),
      cache,
      limiter,
    }).then(
      (r) => {
        res.writeHead(r.status, r.headers);
        res.end(JSON.stringify(r.body));
      },
      () => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "upstream_error" }));
      }
    );
  };
  return {
    name: "viva-mandi-proxy",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

/** Fails the build if a server-only secret value ends up in any emitted file. */
function forbidSecretsInBundle(secrets: (string | undefined)[]): Plugin {
  const values = secrets.filter((s): s is string => !!s && s.length >= 8);
  return {
    name: "viva-forbid-secrets",
    apply: "build",
    generateBundle(_opts, bundle) {
      for (const [file, chunk] of Object.entries(bundle)) {
        const text = chunk.type === "chunk" ? chunk.code : typeof chunk.source === "string" ? chunk.source : "";
        if (values.some((v) => text.includes(v))) this.error(`server-only secret found in ${file}; refusing to build`);
      }
    },
  };
}

// VIVA AI — Vite config
// PWA plugin gives us the service worker + offline caching required by
// HARD CONSTRAINT #2 (offline-first) in the project spec.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = mandiKey(env);
  return {
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    mandiDevProxy(apiKey),
    forbidSecretsInBundle([apiKey]),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.ico",
        "icons/*.svg",
        "icons/*.png",
        "audio/*.mp3",
      ],
      manifest: {
        name: "VIVA AI — Tamil Voice Farming & Fabrication Co-pilot",
        short_name: "VIVA AI",
        description:
          "Tamil voice co-pilot for farming and frugal fabrication",
        theme_color: "#5B7553",
        background_color: "#FBF6EC",
        display: "standalone",
        start_url: "/",
        lang: "ta",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The app shell only. Model weights live under /models/ and are
        // cached on first use by the runtime rule below, so a missing or
        // large model never bloats or breaks the precache manifest.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,mp3}"],
        globIgnores: ["models/**"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/models/"),
            handler: "NetworkFirst",
            options: { cacheName: "viva-model-cache", networkTimeoutSeconds: 8 },
          },
          {
            // Second, network-level cache layer behind the app-level
            // localStorage caches in src/lib/weather.ts and src/lib/mandi.ts.
            urlPattern: /^https:\/\/api\.openweathermap\.org\//,
            handler: "NetworkFirst",
            options: { cacheName: "viva-weather-cache", networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
  build: {
    // TF.js (~1.9 MB) and Leaflet are reached only through dynamic import()
    // and stay in automatic lazy chunks. Do NOT add them to manualChunks:
    // that hoists shared helpers into them and makes them preload at startup.
    // Firebase is needed at startup anyway, so it gets its own cacheable chunk.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/firebase/") || id.includes("node_modules/@firebase/")) return "firebase";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    // /api-mandi/prices is served by the mandiDevProxy plugin above, which
    // adds the key server-side. There is no blind pass-through to data.gov.in.
  },
  };
});
