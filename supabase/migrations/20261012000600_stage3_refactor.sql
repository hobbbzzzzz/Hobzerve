-- Hobzerve Stage 3 (part 1) — internal read models without caller checks, so scheduled jobs and reports can use them.
-- The public RPCs keep their signatures and become thin authorized wrappers.

create or replace function app.week_summary(p_workspace uuid, p_user uuid, p_week_start date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_week date := app.week_start_of(p_week_start);
  v_range tstzrange;
  c public.week_closures;
  v_target integer;
  v_closed integer;
  v_open integer;
  v_reg integer;
  v_ot integer;
  v_in jsonb;
  v_out jsonb;
  v_in_reg integer;
  v_in_ot integer;
  v_close_time time;
  s public.weekly_target_settings;
begin
  v_range := app.week_range(p_workspace, v_week);
  select * into c from public.week_closures where workspace_id = p_workspace and user_id = p_user and week_start = v_week;
  s := app.target_settings(p_workspace, v_week);
  select coalesce((settings -> 'weekly_close' ->> 'time')::time, '23:59:59') into v_close_time from public.workspaces where id = p_workspace;

  v_target := coalesce(c.target_seconds, app.week_target_seconds(p_workspace, p_user, v_week));
  v_closed := app.closed_union_seconds(p_workspace, p_user, v_range);
  v_open := app.open_session_seconds(p_workspace, p_user, v_range);
  v_reg := coalesce(c.regular_seconds, least(v_target, v_closed));
  v_ot := coalesce(c.overtime_seconds, greatest(0, v_closed - v_target));

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb), coalesce(sum(a.regular_delta_seconds), 0), coalesce(sum(a.overtime_delta_seconds), 0)
    into v_in, v_in_reg, v_in_ot
  from public.payroll_adjustments a where a.workspace_id = p_workspace and a.user_id = p_user and a.posted_week_start = v_week;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb) into v_out
  from public.payroll_adjustments a where a.workspace_id = p_workspace and a.user_id = p_user and a.source_week_start = v_week;

  return jsonb_build_object(
    'week_start', v_week,
    'week_end', v_week + 6,
    'payroll_month', to_char(v_week + 6, 'YYYY-MM'),
    'starts_at', lower(v_range),
    'ends_at', upper(v_range),
    'closes_at', app.local_ts(p_workspace, v_week + 7, v_close_time),
    'status', case when c.id is not null then 'closed' when upper(v_range) <= now() then 'awaiting_close' else 'open' end,
    'closure', case when c.id is null then null else to_jsonb(c) end,
    'base_target_minutes', coalesce(s.base_target_minutes, 1200),
    'working_days', to_jsonb(coalesce(s.working_days, '{0,1,2,3,4}'::smallint[])),
    'active_working_days', coalesce(c.active_working_days, app.active_working_days(p_workspace, p_user, v_week)),
    'target_seconds', v_target,
    'closed_seconds', coalesce(c.closed_union_seconds, v_closed),
    'current_closed_seconds', v_closed,
    'provisional_open_seconds', v_open,
    'regular_seconds', v_reg,
    'overtime_seconds', v_ot,
    'adjustments_in', v_in,
    'adjustments_out', v_out,
    'net_regular_seconds', v_reg + v_in_reg,
    'net_overtime_seconds', v_ot + v_in_ot,
    'fingerprint_changed', case when c.id is null then null else c.source_fingerprint <> app.week_fingerprint(p_workspace, p_user, v_week) end
  );
end $$;

create or replace function app.month_overtime(p_workspace uuid, p_user uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_first date := date_trunc('month', p_month)::date;
  v_weeks jsonb := '[]'::jsonb;
  v_week date;
  v_sum jsonb;
  v_total integer := 0;
  v_final boolean := true;
begin
  -- First Friday on/after the 1st, back to its Saturday.
  v_week := app.week_start_of(v_first + ((5 - extract(dow from v_first)::integer + 7) % 7));
  while (v_week + 6) < (v_first + interval '1 month')::date loop
    v_sum := app.week_summary(p_workspace, p_user, v_week);
    v_weeks := v_weeks || jsonb_build_object('week_start', v_week, 'status', v_sum ->> 'status',
      'net_overtime_seconds', (v_sum ->> 'net_overtime_seconds')::integer, 'net_regular_seconds', (v_sum ->> 'net_regular_seconds')::integer);
    v_total := v_total + (v_sum ->> 'net_overtime_seconds')::integer;
    if v_sum ->> 'status' <> 'closed' then v_final := false; end if;
    v_week := v_week + 7;
  end loop;
  return jsonb_build_object('month', to_char(v_first, 'YYYY-MM'), 'weeks', v_weeks, 'net_overtime_seconds', v_total, 'final', v_final);
end $$;

create or replace function public.get_week_summary(p_workspace uuid, p_user uuid, p_week_start date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid();
begin
  if not app.can_view_user_work(p_workspace, p_user) then perform app.raise('HZ404', 'Not found.'); end if;
  return app.week_summary(p_workspace, p_user, p_week_start);
end $$;

create or replace function public.get_month_overtime(p_workspace uuid, p_user uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid();
begin
  if not app.can_view_user_work(p_workspace, p_user) then perform app.raise('HZ404', 'Not found.'); end if;
  return app.month_overtime(p_workspace, p_user, p_month);
end $$;
