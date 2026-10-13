"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

let browserClient: SupabaseClient | undefined;

/** Singleton browser client. Uses the anon key; every read is filtered by RLS and every write goes through RPCs. */
export function getBrowserClient(): SupabaseClient {
  if (!browserClient) {
    const { url, anonKey } = supabaseEnv();
    browserClient = createBrowserClient(url, anonKey);
  }
  return browserClient;
}
