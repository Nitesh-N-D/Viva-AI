import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { activateUpdateAndReload, isUpdateReady, onUpdateReady } from "../../lib/appUpdate";
import { Button } from "./Button";

/**
 * Shown when a newer release has been installed by the service worker but is
 * not active yet. The app never swaps versions under an open screen by itself
 * (that is what used to strand open tabs on deleted chunks); the user decides.
 */
export function UpdateBanner() {
  const { t } = useT();
  const [ready, setReady] = useState(isUpdateReady);
  const [busy, setBusy] = useState(false);
  useEffect(() => onUpdateReady(setReady), []);
  if (!ready) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-20 md:bottom-4 z-50 flex justify-center px-4 pointer-events-none" data-no-read>
      <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl bg-soil-900 text-white px-4 py-3 shadow-lg max-w-md">
        <span className="text-sm">{t("errors.updateReady")}</span>
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void activateUpdateAndReload();
          }}
        >
          {t("errors.updateNow")}
        </Button>
      </div>
    </div>
  );
}
