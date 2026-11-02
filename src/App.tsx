import React, { Suspense, lazy, useEffect } from "react";
import { t as translate, useT } from "./i18n";
import { AppShell } from "./app/AppShell";
import { HomeScreen } from "./app/HomeScreen";
import { SettingsScreen } from "./app/SettingsScreen";
import { navigate, useRoute, routeToHash, type Route } from "./app/router";
import { useAppStore } from "./app/store";
import { Spinner } from "./shared/ui/Feedback";

// Feature screens are split into their own chunks so the first load on a
// slow rural connection only downloads the shell and dashboard.
const ScanScreen = lazy(() => importWithRetry(() => import("./modules/farm/scan/ScanScreen").then((m) => ({ default: m.ScanScreen }))));
const GuidanceScreen = lazy(() => importWithRetry(() => import("./modules/farm/guidance/GuidanceScreen").then((m) => ({ default: m.GuidanceScreen }))));
const CropRecommend = lazy(() => importWithRetry(() => import("./modules/farm/crop-recommend/CropRecommend").then((m) => ({ default: m.CropRecommend }))));
const MyCrop = lazy(() => importWithRetry(() => import("./modules/farm/my-crop/MyCrop").then((m) => ({ default: m.MyCrop }))));
const MandiPrices = lazy(() => importWithRetry(() => import("./modules/farm/mandi-prices/MandiPrices").then((m) => ({ default: m.MandiPrices }))));
const SoilMap = lazy(() => importWithRetry(() => import("./modules/farm/soil-map/SoilMap").then((m) => ({ default: m.SoilMap }))));
const FabricationHome = lazy(() => importWithRetry(() => import("./modules/fabrication/FabricationHome").then((m) => ({ default: m.FabricationHome }))));
const PlannerScreen = lazy(() => importWithRetry(() => import("./modules/planner/PlannerScreen").then((m) => ({ default: m.PlannerScreen }))));
const FinanceScreen = lazy(() => importWithRetry(() => import("./modules/finance/FinanceScreen").then((m) => ({ default: m.FinanceScreen }))));
const IrrigationScreen = lazy(() => importWithRetry(() => import("./modules/irrigation/IrrigationScreen").then((m) => ({ default: m.IrrigationScreen }))));
const AssistantScreen = lazy(() => importWithRetry(() => import("./modules/assistant/AssistantScreen").then((m) => ({ default: m.AssistantScreen }))));
const WatchlistScreen = lazy(() => importWithRetry(() => import("./modules/watchlist/WatchlistScreen").then((m) => ({ default: m.WatchlistScreen }))));
import { importWithRetry, installGlobalErrorHandlers } from "./lib/errors";
import { useTaskReminders } from "./modules/planner/useTaskReminders";
import { ensureAnonymousAuth, isFirebaseConfigured, writeQueuedItem } from "./lib/firebase";
import { registerAutoFlush } from "./shared/offline-sync/SyncQueue";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";
import { Toaster, toast } from "./shared/ui/Toast";

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomeScreen />;
    case "soil":
      return <ScanScreen task="soil" />;
    case "disease":
      return <ScanScreen task="disease" />;
    case "guidance":
      return <GuidanceScreen id={route.id} />;
    case "crops":
      return <CropRecommend key={route.soil ?? ""} soil={route.soil} />;
    case "farm":
      return <MyCrop />;
    case "market":
      return <MandiPrices />;
    case "map":
      return <SoilMap />;
    case "maker":
      return <FabricationHome />;
    case "settings":
      return <SettingsScreen />;
    case "planner":
      return <PlannerScreen />;
    case "finance":
      return <FinanceScreen />;
    case "irrigation":
      return <IrrigationScreen />;
    case "assistant":
      return <AssistantScreen />;
    case "watchlist":
      return <WatchlistScreen />;
  }
}

export default function App() {
  const route = useRoute();
  const { lang } = useT();
  const setLastSync = useAppStore((s) => s.setLastSync);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Unhandled errors are logged (redacted) and surfaced as one friendly toast,
  // at most every 10 s, instead of vanishing silently.
  useEffect(() => {
    let last = 0;
    installGlobalErrorHandlers(() => {
      const now = Date.now();
      if (now - last < 10_000) return;
      last = now;
      toast.error(translate("errors.unexpected"));
    });
  }, []);
  // In-app task reminders while the app is open (no background push).
  useTaskReminders();

  // Firebase is optional: without config the app works fully offline and
  // nothing is queued for upload.
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    void ensureAnonymousAuth();
    return registerAutoFlush(writeQueuedItem, (r) => setLastSync({ at: Date.now(), ...r }));
  }, [setLastSync]);

  return (
    <AppShell route={route}>
      <ErrorBoundary resetKey={routeToHash(route)} onHome={() => navigate({ name: "home" })}>
        <Suspense
          fallback={
            <div className="py-16 flex justify-center">
              <Spinner />
            </div>
          }
        >
          <RouteView route={route} />
        </Suspense>
      </ErrorBoundary>
      <Toaster />
    </AppShell>
  );
}
