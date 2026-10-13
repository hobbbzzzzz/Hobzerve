"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { XCircle } from "../icons";
import { IconButton } from "./button";

/** Right-side panel for quick task edits (Decision 64). Modal semantics via <dialog>. */
export function Drawer({ open, onClose, title, children, headerExtra }: { open: boolean; onClose: () => void; title: string; children: ReactNode; headerExtra?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl border-0 border-l border-line bg-surface p-0 text-ink shadow-[var(--shadow-lift)] sm:rounded-l-[24px]"
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="min-w-0 flex-1">{headerExtra}</div>
            <IconButton label="Close panel" onClick={onClose}>
              <XCircle size={20} />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}
