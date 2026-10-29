-- Every ledger writer locks budgets(owner_id), then app_budget(1), then attempt.
-- Immutable run/attempt identities (00200) permit discovery before those locks.
-- All errors use P0001 + a stable message for the edge adapter's code mapping.
create function public.create_run(
  p_owner uuid, p_suite_id uuid, p_old_model text, p_new_model text, p_k integer, p_manifest jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_suite public.suites%rowtype;
  v_run public.runs%rowtype;
  v_id uuid;
  v_manifest jsonb;
begin
  if p_owner is null or p_suite_id is null or p_k is null or p_k not in (1, 3, 5)
    or p_old_model is null or length(btrim(p_old_model)) = 0
    or p_new_model is null or length(btrim(p_new_model)) = 0
    or p_manifest is null or jsonb_typeof(p_manifest) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select * into v_suite from public.suites where id = p_suite_id and owner_id = p_owner for key share;
  if not found then raise exception using errcode = 'P0001', message = 'not_owner'; end if;
  if jsonb_typeof(v_suite.body->'tasks') is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if jsonb_array_length(v_suite.body->'tasks') not between 1 and 100 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if (p_manifest#>>'{old_model,id}') is distinct from p_old_model
    or (p_manifest#>>'{new_model,id}') is distinct from p_new_model
    or (p_manifest->>'models_config_sha256') is null
    or (p_manifest->>'models_config_sha256') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if coalesce(p_manifest#>>'{old_model,provider}', '') not in ('anthropic', 'openai_compatible')
    or coalesce(p_manifest#>>'{new_model,provider}', '') not in ('anthropic', 'openai_compatible') then
    raise exception using errcode = 'P0001', message = 'model_not_allowed';
  end if;
  if nullif(p_manifest#>>'{old_model,prices,verified_date}', '') is null
    or nullif(p_manifest#>>'{new_model,prices,verified_date}', '') is null then
    raise exception using errcode = 'P0001', message = 'billing_unknown';
  end if;
  begin
    v_id := coalesce((p_manifest->>'run_id')::uuid, gen_random_uuid());
  exception when invalid_text_representation then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end;
  -- Identity and snapshot metadata are authoritative database values. Model/price
  -- configuration is supplied only by the service-side validated manifest builder.
  v_manifest := p_manifest || jsonb_build_object('run_id', v_id, 'suite_sha256', v_suite.sha256,
    'k', p_k, 'mode', 'live');
  insert into public.runs(id, owner_id, suite_id, suite_sha256, old_model, new_model, k, manifest)
    values (v_id, p_owner, p_suite_id, v_suite.sha256, p_old_model, p_new_model, p_k, v_manifest)
    returning * into v_run;
  return jsonb_build_object('outcome', 'created', 'run', to_jsonb(v_run));
end;
$$;

create function public.claim_and_reserve(
  p_run uuid, p_task text, p_side text, p_sample integer, p_reserve_usd numeric, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_run public.runs%rowtype;
  v_user public.budgets%rowtype;
  v_app public.app_budget%rowtype;
  v_attempt public.call_attempts%rowtype;
  v_sample public.samples%rowtype;
  v_model jsonb;
  v_attempt_no integer;
begin
  if p_run is null or p_task is null or p_task !~ '^[A-Za-z0-9._-]{1,64}$'
    or p_side is null or p_side not in ('old', 'new') or p_sample is null or p_sample not between 1 and 5
    or p_request_id is null or p_reserve_usd is null
    or not (p_reserve_usd >= 0 and p_reserve_usd < 'Infinity'::numeric) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select * into v_run from public.runs where id = p_run;
  if not found then raise exception using errcode = 'P0001', message = 'not_owner'; end if;
  if v_run.mode <> 'live' then raise exception using errcode = 'P0001', message = 'not_live_run'; end if;
  if p_sample > v_run.k or not exists (
    select 1 from public.suites s, lateral jsonb_array_elements(s.body->'tasks') t
    where s.id = v_run.suite_id and s.owner_id = v_run.owner_id and t->>'id' = p_task
  ) then raise exception using errcode = 'P0001', message = 'invalid_input'; end if;

  -- A missing budget is still cap_unset; no implicit cap is installed.
  insert into public.budgets(owner_id) values (v_run.owner_id) on conflict (owner_id) do nothing;
  select * into v_user from public.budgets where owner_id = v_run.owner_id for update;
  select * into v_app from public.app_budget where id = 1 for update;
  if not found then raise exception using errcode = 'P0001', message = 'deployment_blocked'; end if;

  -- Repeated keys report their durable state before current eligibility checks:
  -- a completed/unknown request must never become a new provider call.
  select * into v_attempt from public.call_attempts
    where run_id = p_run and task_id = p_task and side = p_side and sample = p_sample and request_id = p_request_id
    for update;
  if found then
    return jsonb_build_object('outcome', 'replay', 'attempt_id', v_attempt.id,
      'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
  end if;
  select * into v_sample from public.samples
    where run_id = p_run and task_id = p_task and side = p_side and sample = p_sample;
  if found then
    return jsonb_build_object('outcome', 'sample_exists', 'sample_id', v_sample.id, 'sample', to_jsonb(v_sample));
  end if;
  if exists (select 1 from public.call_attempts where run_id = p_run and task_id = p_task
    and side = p_side and sample = p_sample and status in ('claimed', 'dispatched')) then
    raise exception using errcode = 'P0001', message = 'in_flight';
  end if;
  perform 1 from public.live_access where owner_id = v_run.owner_id for key share;
  if not found then raise exception using errcode = 'P0001', message = 'no_live_access'; end if;
  if v_user.cap_usd is null then raise exception using errcode = 'P0001', message = 'cap_unset'; end if;
  if v_user.live_blocked then raise exception using errcode = 'P0001', message = 'user_blocked'; end if;
  if v_app.live_blocked or v_app.global_cap_usd is null then
    raise exception using errcode = 'P0001', message = 'deployment_blocked';
  end if;
  if v_user.spent_usd + v_user.reserved_usd + p_reserve_usd > v_user.cap_usd then
    raise exception using errcode = 'P0001', message = 'user_cap_exceeded';
  end if;
  if v_app.spent_usd + v_app.reserved_usd + p_reserve_usd > v_app.global_cap_usd then
    raise exception using errcode = 'P0001', message = 'global_cap_exceeded';
  end if;
  v_model := v_run.manifest -> case when p_side = 'old' then 'old_model' else 'new_model' end;
  if coalesce(v_model->>'provider', '') not in ('anthropic', 'openai_compatible') then
    raise exception using errcode = 'P0001', message = 'model_not_allowed';
  end if;
  if nullif(v_model#>>'{prices,verified_date}', '') is null then
    raise exception using errcode = 'P0001', message = 'billing_unknown';
  end if;
  select coalesce(max(attempt_no), 0) + 1 into v_attempt_no from public.call_attempts
    where run_id = p_run and task_id = p_task and side = p_side and sample = p_sample;
  insert into public.call_attempts(owner_id, run_id, task_id, side, sample, attempt_no, status,
    reserve_usd, provider, model, request_id)
    values (v_run.owner_id, p_run, p_task, p_side, p_sample, v_attempt_no, 'claimed',
      p_reserve_usd, v_model->>'provider', v_model->>'id', p_request_id)
    returning * into v_attempt;
  update public.budgets set reserved_usd = reserved_usd + p_reserve_usd where owner_id = v_run.owner_id;
  update public.app_budget set reserved_usd = reserved_usd + p_reserve_usd where id = 1;
  return jsonb_build_object('outcome', 'claimed', 'attempt_id', v_attempt.id,
    'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
end;
$$;

create function public.mark_dispatched(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid; v_attempt public.call_attempts%rowtype;
begin
  select owner_id into v_owner from public.call_attempts where id = p_attempt;
  if not found then raise exception using errcode = 'P0001', message = 'unknown_attempt'; end if;
  perform 1 from public.budgets where owner_id = v_owner for update;
  if not found then raise exception using errcode = 'P0001', message = 'ledger_inconsistent'; end if;
  perform 1 from public.app_budget where id = 1 for update;
  if not found then raise exception using errcode = 'P0001', message = 'ledger_inconsistent'; end if;
  select * into v_attempt from public.call_attempts where id = p_attempt for update;
  if v_attempt.status = 'dispatched' then
    return jsonb_build_object('outcome', 'replay', 'attempt_id', v_attempt.id,
      'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
  end if;
  if v_attempt.status <> 'claimed' then raise exception using errcode = 'P0001', message = 'invalid_transition'; end if;
  update public.call_attempts set status = 'dispatched', updated_at = clock_timestamp()
    where id = p_attempt returning * into v_attempt;
  return jsonb_build_object('outcome', 'dispatched', 'attempt_id', v_attempt.id,
    'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
end;
$$;

create function public.settle_attempt(p_attempt uuid, p_actual_usd numeric) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_owner uuid; v_attempt public.call_attempts%rowtype;
  v_user public.budgets%rowtype; v_app public.app_budget%rowtype;
begin
  if p_actual_usd is null or not (p_actual_usd >= 0 and p_actual_usd < 'Infinity'::numeric) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select owner_id into v_owner from public.call_attempts where id = p_attempt;
  if not found then raise exception using errcode = 'P0001', message = 'unknown_attempt'; end if;
  select * into v_user from public.budgets where owner_id = v_owner for update;
  if not found then raise exception using errcode = 'P0001', message = 'ledger_inconsistent'; end if;
  select * into v_app from public.app_budget where id = 1 for update;
  if not found then raise exception using errcode = 'P0001', message = 'ledger_inconsistent'; end if;
  select * into v_attempt from public.call_attempts where id = p_attempt for update;
  if v_attempt.status in ('settled', 'overrun') then
    if v_attempt.actual_usd is distinct from p_actual_usd then
      raise exception using errcode = 'P0001', message = 'settlement_amount_mismatch';
    end if;
    return jsonb_build_object('outcome', 'replay', 'attempt_id', v_attempt.id,
      'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
  end if;
  if v_attempt.status <> 'dispatched' then raise exception using errcode = 'P0001', message = 'invalid_transition'; end if;
  if v_user.reserved_usd < v_attempt.reserve_usd or v_app.reserved_usd < v_attempt.reserve_usd then
    raise exception using errcode = 'P0001', message = 'ledger_inconsistent';
  end if;
  update public.budgets set reserved_usd = reserved_usd - v_attempt.reserve_usd,
    spent_usd = spent_usd + p_actual_usd,
    live_blocked = live_blocked or p_actual_usd > v_attempt.reserve_usd,
    blocked_reason = case when p_actual_usd > v_attempt.reserve_usd then 'attempt_overrun:' || p_attempt::text else blocked_reason end
    where owner_id = v_owner;
  update public.app_budget set reserved_usd = reserved_usd - v_attempt.reserve_usd,
    spent_usd = spent_usd + p_actual_usd,
    live_blocked = live_blocked or global_cap_usd is null or spent_usd + p_actual_usd > global_cap_usd
    where id = 1;
  update public.call_attempts set status = case when p_actual_usd > reserve_usd then 'overrun' else 'settled' end,
    actual_usd = p_actual_usd, updated_at = clock_timestamp() where id = p_attempt returning * into v_attempt;
  return jsonb_build_object('outcome', 'settled', 'attempt_id', v_attempt.id,
    'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
end;
$$;

create function public.release_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_owner uuid; v_attempt public.call_attempts%rowtype;
  v_user public.budgets%rowtype; v_app public.app_budget%rowtype;
begin
  select owner_id into v_owner from public.call_attempts where id = p_attempt;
  if not found then raise exception using errcode = 'P0001', message = 'unknown_attempt'; end if;
  select * into v_user from public.budgets where owner_id = v_owner for update;
  if not found then raise exception using errcode = 'P0001', message = 'ledger_inconsistent'; end if;
  select * into v_app from public.app_budget where id = 1 for update;
  if not found then raise exception using errcode = 'P0001', message = 'ledger_inconsistent'; end if;
  select * into v_attempt from public.call_attempts where id = p_attempt for update;
  if v_attempt.status = 'released' then
    return jsonb_build_object('outcome', 'replay', 'attempt_id', v_attempt.id,
      'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
  end if;
  if v_attempt.status <> 'claimed' then raise exception using errcode = 'P0001', message = 'invalid_transition'; end if;
  if v_user.reserved_usd < v_attempt.reserve_usd or v_app.reserved_usd < v_attempt.reserve_usd then
    raise exception using errcode = 'P0001', message = 'ledger_inconsistent';
  end if;
  update public.budgets set reserved_usd = reserved_usd - v_attempt.reserve_usd where owner_id = v_owner;
  update public.app_budget set reserved_usd = reserved_usd - v_attempt.reserve_usd where id = 1;
  update public.call_attempts set status = 'released', updated_at = clock_timestamp()
    where id = p_attempt returning * into v_attempt;
  return jsonb_build_object('outcome', 'released', 'attempt_id', v_attempt.id,
    'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
end;
$$;

create function public.mark_unknown_liability(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid; v_attempt public.call_attempts%rowtype;
begin
  select owner_id into v_owner from public.call_attempts where id = p_attempt;
  if not found then raise exception using errcode = 'P0001', message = 'unknown_attempt'; end if;
  perform 1 from public.budgets where owner_id = v_owner for update;
  if not found then raise exception using errcode = 'P0001', message = 'ledger_inconsistent'; end if;
  perform 1 from public.app_budget where id = 1 for update;
  if not found then raise exception using errcode = 'P0001', message = 'ledger_inconsistent'; end if;
  select * into v_attempt from public.call_attempts where id = p_attempt for update;
  if v_attempt.status = 'unknown_liability' then
    return jsonb_build_object('outcome', 'replay', 'attempt_id', v_attempt.id,
      'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
  end if;
  if v_attempt.status <> 'dispatched' then raise exception using errcode = 'P0001', message = 'invalid_transition'; end if;
  -- No counter moves: an unknown bill remains fully reserved until reconciliation.
  update public.call_attempts set status = 'unknown_liability', updated_at = clock_timestamp()
    where id = p_attempt returning * into v_attempt;
  return jsonb_build_object('outcome', 'unknown_liability', 'attempt_id', v_attempt.id,
    'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
end;
$$;

create function public.reconcile_attempt(
  p_attempt uuid, p_actual_usd numeric, p_evidence_ref text, p_operator text, p_reason text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_owner uuid; v_attempt public.call_attempts%rowtype;
  v_user public.budgets%rowtype; v_app public.app_budget%rowtype; v_actual numeric;
begin
  if (p_actual_usd is not null and not (p_actual_usd >= 0 and p_actual_usd < 'Infinity'::numeric))
    or p_evidence_ref is null or length(btrim(p_evidence_ref)) = 0
    or p_operator is null or length(btrim(p_operator)) = 0 or p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select owner_id into v_owner from public.call_attempts where id = p_attempt;
  if not found then raise exception using errcode = 'P0001', message = 'unknown_attempt'; end if;
  select * into v_user from public.budgets where owner_id = v_owner for update;
  if not found then raise exception using errcode = 'P0001', message = 'ledger_inconsistent'; end if;
  select * into v_app from public.app_budget where id = 1 for update;
  if not found then raise exception using errcode = 'P0001', message = 'ledger_inconsistent'; end if;
  select * into v_attempt from public.call_attempts where id = p_attempt for update;
  if v_attempt.status <> 'unknown_liability' then
    raise exception using errcode = 'P0001', message = 'invalid_transition';
  end if;
  v_actual := coalesce(p_actual_usd, v_attempt.reserve_usd);
  if v_user.reserved_usd < v_attempt.reserve_usd or v_app.reserved_usd < v_attempt.reserve_usd then
    raise exception using errcode = 'P0001', message = 'ledger_inconsistent';
  end if;
  update public.budgets set reserved_usd = reserved_usd - v_attempt.reserve_usd,
    spent_usd = spent_usd + v_actual,
    live_blocked = live_blocked or v_actual > v_attempt.reserve_usd,
    blocked_reason = case when v_actual > v_attempt.reserve_usd then 'reconciled_overrun:' || p_attempt::text else blocked_reason end
    where owner_id = v_owner;
  update public.app_budget set reserved_usd = reserved_usd - v_attempt.reserve_usd,
    spent_usd = spent_usd + v_actual,
    live_blocked = live_blocked or global_cap_usd is null or spent_usd + v_actual > global_cap_usd
    where id = 1;
  -- Reconciliation has the explicit unknown_liability -> settled contract. A
  -- reconciliation above reserve still blocks the user and checks global spend.
  update public.call_attempts set status = 'settled', actual_usd = v_actual, updated_at = clock_timestamp()
    where id = p_attempt returning * into v_attempt;
  insert into public.ledger_audit(attempt_id, action, amount_usd, evidence_ref, operator, reason)
    values (p_attempt, 'reconcile_attempt', v_actual, p_evidence_ref, p_operator, p_reason);
  return jsonb_build_object('outcome', 'settled', 'attempt_id', v_attempt.id,
    'status', v_attempt.status, 'attempt', to_jsonb(v_attempt));
end;
$$;

create function public.unblock_user(p_owner_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_user public.budgets%rowtype;
begin
  if p_owner_id is null or p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  select * into v_user from public.budgets where owner_id = p_owner_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'not_owner'; end if;
  perform 1 from public.app_budget where id = 1 for update;
  if not found then raise exception using errcode = 'P0001', message = 'deployment_blocked'; end if;
  -- Does not release reservations, forgive spend, change caps, or unblock deployment.
  update public.budgets set live_blocked = false, blocked_reason = null
    where owner_id = p_owner_id returning * into v_user;
  insert into public.ledger_audit(action, evidence_ref, operator, reason)
    values ('unblock_user', 'owner:' || p_owner_id::text, session_user::text, p_reason);
  return jsonb_build_object('outcome', 'unblocked', 'budget', to_jsonb(v_user));
end;
$$;

create function public.set_my_cap(p_cap_usd numeric) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_owner uuid := auth.uid(); v_user public.budgets%rowtype;
begin
  if v_owner is null then raise exception using errcode = 'P0001', message = 'no_user'; end if;
  if p_cap_usd is not null and not (p_cap_usd >= 0 and p_cap_usd < 'Infinity'::numeric) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  -- Defaults initialise a new row; conflicts update ONLY cap_usd. Callers cannot
  -- select another owner or edit spent/reserved/blocked state, even with NULL cap.
  insert into public.budgets(owner_id, cap_usd) values (v_owner, p_cap_usd)
    on conflict (owner_id) do update set cap_usd = excluded.cap_usd returning * into v_user;
  return to_jsonb(v_user);
end;
$$;

-- Revoke immediately as well as explicitly in 00500: no default PUBLIC window.
revoke all on function public.create_run(uuid, uuid, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.claim_and_reserve(uuid, text, text, integer, numeric, uuid) from public, anon, authenticated;
revoke all on function public.mark_dispatched(uuid) from public, anon, authenticated;
revoke all on function public.settle_attempt(uuid, numeric) from public, anon, authenticated;
revoke all on function public.release_attempt(uuid) from public, anon, authenticated;
revoke all on function public.mark_unknown_liability(uuid) from public, anon, authenticated;
revoke all on function public.reconcile_attempt(uuid, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.unblock_user(uuid, text) from public, anon, authenticated;
revoke all on function public.set_my_cap(numeric) from public, anon, authenticated;
