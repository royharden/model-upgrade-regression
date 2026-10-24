-- Trigger functions are invokers; no client can execute them directly (file 00500).
create function public.reject_immutable_change() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception using errcode = 'P0001', message = 'immutable_record';
end;
$$;

create trigger samples_immutable before update or delete on public.samples
  for each row execute function public.reject_immutable_change();
create trigger rulings_immutable before update or delete on public.rulings
  for each row execute function public.reject_immutable_change();
create trigger ledger_audit_immutable before update or delete on public.ledger_audit
  for each row execute function public.reject_immutable_change();
create trigger suites_immutable before update on public.suites
  for each row execute function public.reject_immutable_change();

create function public.guard_run_snapshot() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'immutable_record';
  end if;
  if (new.id, new.owner_id, new.suite_id, new.suite_sha256, new.old_model, new.new_model,
      new.k, new.mode, new.manifest, new.created_at)
    is distinct from
     (old.id, old.owner_id, old.suite_id, old.suite_sha256, old.old_model, old.new_model,
      old.k, old.mode, old.manifest, old.created_at) then
    raise exception using errcode = 'P0001', message = 'immutable_run_snapshot';
  end if;
  return new;
end;
$$;
create trigger runs_frozen before update or delete on public.runs
  for each row execute function public.guard_run_snapshot();

create function public.guard_attempt_identity() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'immutable_record';
  end if;
  -- Ledger RPCs discover owner without locking, then lock user -> app -> attempt.
  -- This immutable identity makes that discovery safe; state is reread under lock.
  if (new.id, new.owner_id, new.run_id, new.task_id, new.side, new.sample, new.attempt_no,
      new.reserve_usd, new.provider, new.model, new.request_id, new.created_at)
    is distinct from
     (old.id, old.owner_id, old.run_id, old.task_id, old.side, old.sample, old.attempt_no,
      old.reserve_usd, old.provider, old.model, old.request_id, old.created_at) then
    raise exception using errcode = 'P0001', message = 'immutable_attempt_identity';
  end if;
  return new;
end;
$$;
create trigger call_attempts_identity before update or delete on public.call_attempts
  for each row execute function public.guard_attempt_identity();

create function public.guard_ruling_supersession() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_target public.rulings%rowtype;
begin
  if new.kind = 'tombstone' then
    select * into v_target from public.rulings where id = new.supersedes;
    if not found or v_target.owner_id <> new.owner_id or v_target.finding_id <> new.finding_id
      or (v_target.created_at, v_target.id::text) >= (new.created_at, new.id::text) then
      raise exception using errcode = 'P0001', message = 'invalid_supersession';
    end if;
    -- Replay is owner + finding scoped across runs, as in core/rulings.ts.
    -- A tombstone can itself be superseded; all events remain insert-only.
  end if;
  return new;
end;
$$;
create trigger rulings_supersession before insert on public.rulings
  for each row execute function public.guard_ruling_supersession();

create function public.guard_sample_key() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_run public.runs%rowtype;
begin
  select * into v_run from public.runs where id = new.run_id and owner_id = new.owner_id;
  if not found or new.sample > v_run.k then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  if not exists (select 1 from public.suites s, lateral jsonb_array_elements(s.body->'tasks') t
    where s.id = v_run.suite_id and s.owner_id = new.owner_id and t->>'id' = new.task_id) then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;
  return new;
end;
$$;
create trigger samples_key before insert on public.samples
  for each row execute function public.guard_sample_key();
