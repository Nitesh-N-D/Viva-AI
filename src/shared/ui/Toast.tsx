import React, { useEffect } from "react";
import { create } from "zustand";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (tone, message) => set((s) => ({ toasts: [...s.toasts.slice(-2), { id: nextId++, tone, message }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  success: (m: string) => useToastStore.getState().push("success", m),
  error: (m: string) => useToastStore.getState().push("error", m),
  info: (m: string) => useToastStore.getState().push("info", m),
};

const toneClasses: Record<ToastTone, string> = {
  success: "bg-leaf-800 text-white",
  error: "bg-danger-600 text-white",
  info: "bg-soil-900 text-white",
};

function ToastView({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), 4000);
    return () => window.clearTimeout(timer);
  }, [item.id, dismiss]);
  return (
    <div className={`pointer-events-auto flex items-center gap-3 rounded-card px-4 py-3 shadow-raised text-sm ${toneClasses[item.tone]}`}>
      <span className="flex-1">{item.message}</span>
      <button type="button" onClick={() => dismiss(item.id)} aria-label="×" className="min-w-[32px] min-h-[32px] opacity-80 hover:opacity-100">
        ×
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div aria-live="polite" className="fixed inset-x-0 bottom-20 md:bottom-6 z-[1000] flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map((item) => (
        <ToastView key={item.id} item={item} />
      ))}
    </div>
  );
}
