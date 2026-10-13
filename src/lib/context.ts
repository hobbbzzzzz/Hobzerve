import "server-only";
import { redirect } from "next/navigation";
import { getServerClient } from "./supabase/server";
import type { Member, Profile, SessionContext, Workspace } from "./types";

export type ContextResult = { ok: true; ctx: SessionContext } | { ok: false; reason: "no_workspace"; email: string };

/** Loads the signed-in user's profile, first active workspace membership and its members (all through RLS). */
export async function loadSessionContext(): Promise<ContextResult> {
  const supabase = await getServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>();
  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at")
    .returns<Member[]>();

  const today = new Date().toISOString().slice(0, 10);
  const active = (memberships ?? []).find((m) => m.active_from <= today && (!m.active_to || m.active_to >= today));
  if (!profile || !active) return { ok: false, reason: "no_workspace", email: user.email ?? "" };

  const { data: workspace } = await supabase.from("workspaces").select("*").eq("id", active.workspace_id).single<Workspace>();
  const { data: members } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", active.workspace_id)
    .returns<Member[]>();
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, job_title, email")
    .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .returns<Pick<Profile, "id" | "display_name" | "job_title" | "email">[]>();
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

  if (!workspace) return { ok: false, reason: "no_workspace", email: user.email ?? "" };

  return {
    ok: true,
    ctx: {
      userId: user.id,
      profile,
      workspace,
      role: active.role,
      members: (members ?? [])
        .filter((m) => byId.has(m.user_id))
        .map((m) => ({ ...m, profile: byId.get(m.user_id)! })),
    },
  };
}
