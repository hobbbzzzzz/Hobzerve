-- Hobzerve Stage 1 — access helpers, RLS policies and grants.
-- Model: authenticated users may SELECT through RLS; all writes go through SECURITY DEFINER RPCs.

-- ───────────── Helpers ─────────────
create or replace function app.raise(p_code text, p_message text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_message using errcode = p_code;
end $$;

create or replace function app.current_uid() returns uuid
language sql stable set search_path = '' as $$
  select auth.uid()
$$;

-- Active membership role of a user in a workspace (null when not an active member).
create or replace function app.member_role(p_workspace uuid, p_user uuid default auth.uid())
returns public.member_role
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  where m.workspace_id = p_workspace
    and m.user_id = p_user
    and m.active_from <= (now() at time zone w.timezone)::date
    and (m.active_to is null or m.active_to >= (now() at time zone w.timezone)::date)
$$;

create or replace function app.is_member(p_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.member_role(p_workspace) is not null
$$;

create or replace function app.is_manager(p_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.member_role(p_workspace) = 'manager'
$$;

-- Managers see all employee work in their workspace; employees see their own.
create or replace function app.can_view_user_work(p_workspace uuid, p_subject uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case app.member_role(p_workspace)
    when 'manager' then true
    when 'employee' then p_subject = auth.uid()
    else false
  end
$$;

create or replace function app.can_view_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task and app.can_view_user_work(t.workspace_id, t.assignee_id)
  )
$$;

-- Everyone relevant to a piece of employee work, minus the actor (Decision 59: no self-notification).
create or replace function app.counterparts(p_workspace uuid, p_subject uuid, p_actor uuid)
returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct u), '{}')
  from (
    select p_subject as u
    union
    select m.user_id from public.workspace_members m
    where m.workspace_id = p_workspace and m.role = 'manager' and m.active_to is null
  ) s
  where u is not null and u is distinct from p_actor
$$;

-- Write one immutable audit event and notify counterparts. Critical events ignore mutes (Decision 55).
create or replace function app.emit(
  p_workspace uuid,
  p_actor uuid,
  p_subject uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_task uuid,
  p_event_type text,
  p_summary text,
  p_old jsonb default null,
  p_new jsonb default null,
  p_meta jsonb default '{}'::jsonb,
  p_critical boolean default false,
  p_link text default null,
  p_request_id text default null,
  p_recipients uuid[] default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_event uuid;
  v_recipient uuid;
  v_muted boolean;
begin
  insert into public.audit_events (workspace_id, actor_id, subject_user_id, entity_type, entity_id, task_id,
                                   event_type, summary, old_json, new_json, metadata_json, request_id)
  values (p_workspace, p_actor, p_subject, p_entity_type, p_entity_id, p_task,
          p_event_type, p_summary, p_old, p_new, coalesce(p_meta, '{}'::jsonb), p_request_id)
  returning id into v_event;

  foreach v_recipient in array coalesce(p_recipients, app.counterparts(p_workspace, p_subject, p_actor)) loop
    continue when v_recipient = p_actor;
    select coalesce((p.preferences -> 'muted_event_types') ? p_event_type, false)
      into v_muted from public.profiles p where p.id = v_recipient;
    continue when coalesce(v_muted, false) and not p_critical;
    insert into public.notifications (workspace_id, recipient_id, audit_event_id, event_type, group_key,
                                      title, body, link, critical)
    values (p_workspace, v_recipient, v_event, p_event_type,
            p_event_type || ':' || coalesce(p_entity_id::text, ''),
            p_summary, p_meta ->> 'body', p_link, p_critical);
  end loop;

  return v_event;
end $$;

-- ───────────── Row level security ─────────────
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_members enable row level security;
alter table public.categories enable row level security;
alter table public.recurrence_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.scope_cycles enable row level security;
alter table public.revision_rounds enable row level security;
alter table public.deliverables enable row level security;
alter table public.deliverable_revisions enable row level security;
alter table public.deliverable_evidence enable row level security;
alter table public.task_completion_events enable row level security;
alter table public.deadline_changes enable row level security;
alter table public.task_status_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.notifications enable row level security;
alter table public.email_deliveries enable row level security;

create policy workspaces_read on public.workspaces for select to authenticated
  using (app.is_member(id));

create policy profiles_read on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.workspace_members mine
      join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = auth.uid() and theirs.user_id = profiles.id
    )
  );

create policy members_read on public.workspace_members for select to authenticated
  using (app.is_member(workspace_id));

create policy categories_read on public.categories for select to authenticated
  using (app.is_member(workspace_id));

create policy recurrence_read on public.recurrence_templates for select to authenticated
  using (app.can_view_user_work(workspace_id, assignee_id));

create policy tasks_read on public.tasks for select to authenticated
  using (app.can_view_user_work(workspace_id, assignee_id));

create policy dependencies_read on public.task_dependencies for select to authenticated
  using (app.can_view_task(task_id));

create policy scope_cycles_read on public.scope_cycles for select to authenticated
  using (app.can_view_task(task_id));

create policy revision_rounds_read on public.revision_rounds for select to authenticated
  using (app.can_view_task(task_id));

create policy deliverables_read on public.deliverables for select to authenticated
  using (app.can_view_task(task_id));

create policy deliverable_revisions_read on public.deliverable_revisions for select to authenticated
  using (exists (select 1 from public.deliverables d where d.id = deliverable_id and app.can_view_task(d.task_id)));

create policy deliverable_evidence_read on public.deliverable_evidence for select to authenticated
  using (exists (select 1 from public.deliverables d where d.id = deliverable_id and app.can_view_task(d.task_id)));

create policy completion_events_read on public.task_completion_events for select to authenticated
  using (app.can_view_task(task_id));

create policy deadline_changes_read on public.deadline_changes for select to authenticated
  using (app.can_view_task(task_id));

create policy status_events_read on public.task_status_events for select to authenticated
  using (app.can_view_task(task_id));

create policy audit_read on public.audit_events for select to authenticated
  using (
    app.is_member(workspace_id)
    and (subject_user_id is null and app.is_manager(workspace_id)
         or app.can_view_user_work(workspace_id, subject_user_id))
  );

create policy notifications_read on public.notifications for select to authenticated
  using (recipient_id = auth.uid());

-- email_deliveries: no client policy (service role only).

-- ───────────── Grants ─────────────
-- Supabase grants new objects to anon/authenticated by default; turn that off for objects this role creates,
-- so every later migration must grant explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;
revoke all on public.email_deliveries from authenticated;

grant usage on schema app to authenticated;
revoke all on all functions in schema app from public, anon;
grant execute on function
  app.current_uid(), app.member_role(uuid, uuid), app.is_member(uuid), app.is_manager(uuid),
  app.can_view_user_work(uuid, uuid), app.can_view_task(uuid)
  to authenticated;

-- Realtime: deliver notification inserts to the recipient (RLS applies to postgres_changes).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
