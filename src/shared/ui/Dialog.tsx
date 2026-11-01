import React, { useEffect, useRef } from "react";
import { useT } from "../../i18n";

/**
 * Modal built on the native <dialog> element: focus trapping, Esc to
 * close and inert background come from the browser.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useT();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="w-[min(92vw,32rem)] max-h-[85vh] rounded-card p-0 shadow-raised backdrop:bg-soil-900/40"
      aria-labelledby="dialog-title"
    >
      <div className="flex items-center justify-between gap-2 border-b border-soil-100 px-4 py-3">
        <h2 id="dialog-title" className="font-display font-semibold text-lg">
          {title}
        </h2>
        <button type="button" onClick={onClose} className="min-w-[44px] min-h-[44px] text-xl text-soil-600" aria-label={t("common.close")}>
          ×
        </button>
      </div>
      <div className="p-4 overflow-y-auto">{open && children}</div>
    </dialog>
  );
}
