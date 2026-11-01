import React from "react";
import { useLangStore, useT } from "../i18n";
import { districtName } from "../domain/districts";
import { navigate, type Route, type RouteName } from "./router";
import { useAppStore } from "./store";
import { useSyncStatus } from "./useSync";

interface NavItem {
  route: Route;
  match: RouteName[];
  icon: string;
  labelKey: "nav.home" | "nav.scan" | "nav.market" | "nav.map" | "nav.maker" | "nav.crops" | "nav.settings";
}

const NAV: NavItem[] = [
  { route: { name: "home" }, match: ["home", "settings"], icon: "🏠", labelKey: "nav.home" },
  { route: { name: "soil" }, match: ["soil", "disease", "guidance"], icon: "📷", labelKey: "nav.scan" },
  { route: { name: "crops", soil: null }, match: ["crops", "farm"], icon: "🌾", labelKey: "nav.crops" },
  { route: { name: "market" }, match: ["market"], icon: "₹", labelKey: "nav.market" },
  { route: { name: "map" }, match: ["map"], icon: "🗺️", labelKey: "nav.map" },
  { route: { name: "maker" }, match: ["maker"], icon: "🔧", labelKey: "nav.maker" },
];

function SyncIndicator() {
  const { t } = useT();
  const { stats, online, configured } = useSyncStatus();
  let text: string;
  let dot: string;
  if (!online) {
    text = t("sync.offlineShort");
    dot = "bg-soil-400";
  } else if (!configured) {
    text = t("sync.localOnly");
    dot = "bg-soil-400";
  } else if (stats.failing > 0) {
    text = t("sync.failedShort", { count: stats.failing });
    dot = "bg-danger-600";
  } else if (stats.total > 0) {
    text = t("sync.pendingShort", { count: stats.total });
    dot = "bg-ember-400";
  } else {
    text = t("sync.syncedShort");
    dot = "bg-leaf-400";
  }
  return (
    <button
      type="button"
      onClick={() => navigate({ name: "settings" })}
      className="hidden sm:inline-flex items-center gap-2 min-h-[44px] px-2 rounded-tile text-xs text-soil-700 hover:bg-soil-100"
      title={t("sync.title")}
    >
      <span className={`w-2.5 h-2.5 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </button>
  );
}

export function AppShell({ route, children }: { route: Route; children: React.ReactNode }) {
  const { t, lang } = useT();
  const setLang = useLangStore((s) => s.setLang);
  const location = useAppStore((s) => s.location);
  const online = useSyncStatus().online;
  const placeLabel = location?.district
    ? districtName(location.district, lang)
    : location?.coords
      ? t("home.nearYou")
      : t("home.setLocation");

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-soil-50">
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[2000] focus:bg-white focus:px-4 focus:py-2 focus:rounded-tile focus:shadow-raised"
      >
        {t("common.skipToContent")}
      </a>

      {/* Sidebar (md and up) */}
      <nav aria-label={t("nav.label")} className="no-print hidden md:flex md:flex-col md:w-56 lg:w-64 shrink-0 bg-white border-r border-soil-100 sticky top-0 h-screen">
        <div className="px-5 py-5">
          <p className="font-display font-extrabold text-xl text-leaf-800">{t("appName")}</p>
          <p className="text-xs text-soil-500 mt-0.5">{t("tagline")}</p>
        </div>
        <ul className="flex flex-col gap-1 px-3">
          {[...NAV, { route: { name: "settings" } as Route, match: ["settings"] as RouteName[], icon: "⚙️", labelKey: "nav.settings" as const }].map((item) => {
            const active = item.match.includes(route.name) && !(item.labelKey === "nav.home" && route.name === "settings");
            return (
              <li key={item.labelKey}>
                <button
                  type="button"
                  onClick={() => navigate(item.route)}
                  aria-current={active ? "page" : undefined}
                  className={`w-full flex items-center gap-3 min-h-[48px] px-3 rounded-tile text-left font-semibold ${
                    active ? "bg-leaf-50 text-leaf-800" : "text-soil-700 hover:bg-soil-50"
                  }`}
                >
                  <span aria-hidden="true" className="w-6 text-center text-lg">
                    {item.icon}
                  </span>
                  {t(item.labelKey)}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="no-print sticky top-0 z-[500] bg-white/95 backdrop-blur border-b border-soil-100">
          <div className="flex items-center gap-2 px-3 py-2 max-w-6xl mx-auto w-full">
            <button
              type="button"
              onClick={() => navigate({ name: "home" })}
              className="md:hidden font-display font-extrabold text-lg text-leaf-800 min-h-[44px] px-1"
            >
              {t("appName")}
            </button>
            <button
              type="button"
              onClick={() => navigate({ name: "settings" })}
              className="inline-flex items-center gap-1 min-h-[44px] px-2 rounded-tile text-sm text-soil-700 hover:bg-soil-100 truncate max-w-[45vw]"
              aria-label={t("home.changeLocation")}
            >
              <span aria-hidden="true">📍</span>
              <span className="truncate">{placeLabel}</span>
            </button>
            <div className="flex-1" />
            <SyncIndicator />
            <button
              type="button"
              onClick={() => setLang(lang === "ta" ? "en" : "ta")}
              className="min-h-[44px] px-3 rounded-tile border border-soil-200 text-sm font-semibold text-soil-800 hover:bg-soil-50"
              lang={lang === "ta" ? "en" : "ta"}
              aria-label={t("common.switchLanguage")}
            >
              {t("common.languageToggle")}
            </button>
            <button
              type="button"
              onClick={() => navigate({ name: "settings" })}
              className="md:hidden min-w-[44px] min-h-[44px] rounded-tile text-lg hover:bg-soil-100"
              aria-label={t("nav.settings")}
            >
              <span aria-hidden="true">⚙️</span>
            </button>
          </div>
          {!online && (
            <p role="status" className="bg-soil-900 text-white text-xs text-center py-1 px-3">
              {t("common.offline")}
            </p>
          )}
        </header>

        <main id="main" tabIndex={-1} className="flex-1 pb-24 md:pb-8 focus:outline-none">
          {children}
        </main>
      </div>

      {/* Bottom navigation (mobile) */}
      <nav aria-label={t("nav.label")} className="no-print md:hidden fixed bottom-0 inset-x-0 z-[600] bg-white border-t border-soil-100 pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-6">
          {NAV.map((item) => {
            const active = item.match.includes(route.name) && !(item.labelKey === "nav.home" && route.name === "settings");
            return (
              <li key={item.labelKey}>
                <button
                  type="button"
                  onClick={() => navigate(item.route)}
                  aria-current={active ? "page" : undefined}
                  className={`w-full flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-semibold leading-tight ${
                    active ? "text-leaf-700" : "text-soil-600"
                  }`}
                >
                  <span aria-hidden="true" className={`text-lg ${active ? "" : "grayscale opacity-80"}`}>
                    {item.icon}
                  </span>
                  <span className="truncate max-w-full px-0.5">{t(item.labelKey)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
