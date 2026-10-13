"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errors";
import { useToast } from "@/components/ui/toast";
import { useWorkspace } from "@/components/workspace-provider";

/**
 * Minimal data hook: runs `load` on mount and whenever deps or the workspace refresh key change.
 * Keeps the last good data while refetching so screens never flash empty.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const { refreshKey } = useWorkspace();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const [localKey, setLocalKey] = useState(0);

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    load()
      .then((d) => {
        if (mine !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (mine !== seq.current) return;
        setError(friendlyError(e as Error));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshKey, localKey]);

  const reload = useCallback(() => setLocalKey((k) => k + 1), []);
  return { data, error, loading, reload };
}

/** Throws the PostgREST error so useLoad can surface it. */
export function unwrap<T>(res: { data: T | null; error: PostgrestError | null }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

/** Calls an RPC, toasts errors, and refreshes the workspace on success. */
export function useRpc() {
  const toast = useToast();
  const { refresh } = useWorkspace();
  const [pending, setPending] = useState(false);

  const call = useCallback(
    async <T = unknown>(fn: string, args: Record<string, unknown>, opts: { success?: string; silent?: boolean } = {}) => {
      setPending(true);
      try {
        const { data, error } = await getBrowserClient().rpc(fn, args);
        if (error) {
          if (!opts.silent) toast("error", friendlyError(error));
          if (error.code === "HZ409") refresh();
          return { ok: false as const, error };
        }
        if (opts.success) toast("success", opts.success);
        refresh();
        return { ok: true as const, data: data as T };
      } finally {
        setPending(false);
      }
    },
    [toast, refresh],
  );

  return { call, pending };
}
