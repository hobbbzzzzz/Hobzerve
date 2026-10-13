"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { IconContext } from "./icons";
import { ToastProvider } from "./ui/toast";
import type { SessionContext } from "@/lib/types";

interface WorkspaceValue extends SessionContext {
  isManager: boolean;
  employees: SessionContext["members"];
  nameOf: (userId: string | null | undefined) => string;
  /** Bumped whenever anything should refetch (mutations, realtime notifications, window focus). */
  refreshKey: number;
  refresh: () => void;
}

const Ctx = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ ctx, children }: { ctx: SessionContext; children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const value = useMemo<WorkspaceValue>(() => {
    const names = new Map(ctx.members.map((m) => [m.user_id, m.profile.display_name]));
    return {
      ...ctx,
      isManager: ctx.role === "manager",
      employees: ctx.members.filter((m) => m.role === "employee" && !m.active_to),
      nameOf: (id) => (id ? (names.get(id) ?? "Former member") : "System"),
      refreshKey,
      refresh,
    };
  }, [ctx, refreshKey, refresh]);

  return (
    <Ctx.Provider value={value}>
      <IconContext.Provider value={{ weight: "fill", size: 20 }}>
        <ToastProvider>{children}</ToastProvider>
      </IconContext.Provider>
    </Ctx.Provider>
  );
}

export function useWorkspace(): WorkspaceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}
