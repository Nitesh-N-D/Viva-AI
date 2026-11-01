import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";

// VIVA AI — Vite config
// PWA plugin gives us the service worker + offline caching required by
// HARD CONSTRAINT #2 (offline-first) in the project spec.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
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
          {
            urlPattern: /^https:\/\/api\.data\.gov\.in\//,
            handler: "NetworkFirst",
            options: { cacheName: "viva-mandi-cache", networkTimeoutSeconds: 5 },
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
    proxy: {
      // Forward /api-mandi/ → https://api.data.gov.in/
      // This runs inside Node.js (no browser CORS rules), so it works
      // perfectly on localhost without any external CORS proxy service.
      "/api-mandi": {
        target: "https://api.data.gov.in",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-mandi/, ""),
        secure: true,
      },
    },
  },
});
