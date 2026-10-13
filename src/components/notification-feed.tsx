"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { useWorkspace } from "./workspace-provider";
import { useToast } from "./ui/toast";
import type { Notification } from "@/lib/types";

type SyncState = "live" | "connecting" | "offline";

/**
 * Subscribes to the signed-in user's notifications over Supabase Realtime. Every insert bumps the
 * workspace refresh key so open screens refetch (degrades to refetch-on-focus when realtime is down).
 */
export function useNotificationFeed() {
  const { userId, refresh, refreshKey } = useWorkspace();
  const toast = useToast();
  const [unread, setUnread] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("connecting");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBrowserClient()
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .is("read_at", null)
      .then(({ count, error }) => {
        if (cancelled) return;
        if (!error) {
          setUnread(count ?? 0);
          setLastSyncedAt(new Date());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_id=eq.${userId}` },
        (payload) => {
          const n = payload.new as Notification;
          if (n.critical) toast("success", n.title);
          refresh();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setSyncState("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setSyncState("offline");
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, refresh, toast]);

  return { unread, syncState, lastSyncedAt };
}
