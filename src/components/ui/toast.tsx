"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle, Warning, WarningCircle, XCircle } from "../icons";

type ToastKind = "success" | "error" | "warning";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastCtx = createContext<(kind: ToastKind, message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, kind, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "success" ? 3500 : 7000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:items-end" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[16px] border border-line bg-surface px-4 py-3 text-sm shadow-[var(--shadow-lift)]"
          >
            {t.kind === "success" ? (
              <CheckCircle size={20} className="mt-0.5 shrink-0 text-success" />
            ) : t.kind === "warning" ? (
              <Warning size={20} className="mt-0.5 shrink-0 text-warning" />
            ) : (
              <WarningCircle size={20} className="mt-0.5 shrink-0 text-danger" />
            )}
            <p className="flex-1 text-ink">{t.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              className="text-ink-soft hover:text-ink"
              onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
            >
              <XCircle size={18} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
