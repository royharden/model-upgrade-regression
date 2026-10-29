-- AUTHORED ONLY; not executed during construction/Dirty Mode.
-- DESTRUCTIVE TEST FIXTURES: require a fresh, isolated database with the five
-- migrations applied and two existing throwaway auth users. No provider calls.
-- Never point this at production. No auth users or credentials are created here.
-- Later, explicitly supply the isolated connection and the two test user UUIDs:
-- psql <isolated-connection> -v test_owner_a=<uuid> -v test_owner_b=<uuid> -f tests/database/ledger.integration.sql
-- All synthetic budgets, allowlist rows, suites, runs and samples roll back.
\set ON_ERROR_STOP on
\if :{?test_owner_a}
\else
  \echo 'test_owner_a must identify an existing throwaway user on an isolated target'
  \quit 1
\endif
\if :{?test_owner_b}
\else
  \echo 'test_owner_b must identify a different existing throwaway user'
  \quit 1
\endif

begin;
select set_config('m5.owner_a', :'test_owner_a', true);
select set_config('m5.owner_b', :'test_owner_b', true);

create function pg_temp.assert_true(p_value boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_value is distinct from true then raise exception 'ASSERTION FAILED: %', p_label; end if;
end;
$$;
create function pg_temp.expect_error(p_sql text, p_message text, p_state text default 'P0001') returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state and (p_message is null or sqlerrm = p_message) then return; end if;
    raise exception 'Expected %/%, got %/% for %', p_state, p_message, sqlstate, sqlerrm, p_sql;
  end;
  raise exception 'Expected error %/% was not raised for %', p_state, p_message, p_sql;
end;
$$;

do $$
declare
  a uuid := current_setting('m5.owner_a')::uuid;
  b uuid := current_setting('m5.owner_b')::uuid;
  suite_a uuid; suite_b uuid; run_a uuid; run_b uuid; attempt uuid; unknown_attempt uuid;
  req uuid := gen_random_uuid(); response jsonb; replay jsonb; before_row jsonb;
  ruling uuid; tombstone uuid; frozen jsonb; v_count integer;
begin
  perform pg_temp.assert_true(a <> b and exists(select 1 from auth.users where id = a)
    and exists(select 1 from auth.users where id = b), 'two existing distinct isolated auth fixtures');
  perform pg_temp.assert_true(not exists(select 1 from public.suites)
    and not exists(select 1 from public.runs) and not exists(select 1 from public.app_budget)
    and not exists(select 1 from public.budgets) and not exists(select 1 from public.live_access),
    'fresh target required: refuse an existing app database');

  select count(*) into v_count from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('suites','runs','samples','rulings','budgets',
      'app_budget','live_access','ledger_audit','call_attempts') and c.relrowsecurity;
  perform pg_temp.assert_true(v_count = 9, 'RLS enabled on all nine tables');
  perform pg_temp.assert_true(not has_function_privilege('anon', 'public.set_my_cap(numeric)', 'execute')
    and has_function_privilege('authenticated', 'public.set_my_cap(numeric)', 'execute')
    and not has_function_privilege('service_role', 'public.set_my_cap(numeric)', 'execute'), 'cap RPC exception grant');
  perform pg_temp.assert_true(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('create_run','claim_and_reserve','mark_dispatched',
      'settle_attempt','release_attempt','mark_unknown_liability','reconcile_attempt','unblock_user')
      and (not p.prosecdef or not has_function_privilege('service_role', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute')
        or not ('search_path=pg_catalog, public' = any(p.proconfig)))
  ), 'service-only definers have pinned path and no client execution');
  perform pg_temp.assert_true(not has_table_privilege('anon', 'public.suites', 'select')
    and not has_table_privilege('authenticated', 'public.runs', 'insert')
    and not has_table_privilege('authenticated', 'public.samples', 'insert')
    and not has_table_privilege('authenticated', 'public.budgets', 'update')
    and not has_table_privilege('authenticated', 'public.ledger_audit', 'select'), 'client mutation boundaries');

  -- Synthetic test-local amounts, never deployment defaults.
  insert into public.budgets(owner_id,cap_usd) values(a,1),(b,2);
  insert into public.app_budget(id,global_cap_usd) values(1,2);
  insert into public.live_access(owner_id,note) values(a,'rollback test'),(b,'rollback test');
  insert into public.suites(owner_id,name,body,sha256)
    values(a,'A','{"id":"domain-suite-a","name":"A","tasks":[{"id":"task.one"}]}',repeat('a',64)) returning id into suite_a;
  insert into public.suites(owner_id,name,body,sha256)
    values(b,'B','{"id":"domain-suite-b","name":"B","tasks":[{"id":"task.one"}]}',repeat('b',64)) returning id into suite_b;
  frozen := jsonb_build_object('models_config_sha256',repeat('c',64),
    'old_model',jsonb_build_object('id','test:old','provider','anthropic','prices',jsonb_build_object('verified_date','2026-01-01')),
    'new_model',jsonb_build_object('id','test:new','provider','openai_compatible','prices',jsonb_build_object('verified_date','2026-01-01')));
  response := public.create_run(a,suite_a,'test:old','test:new',3,frozen);
  run_a := (response#>>'{run,id}')::uuid;
  run_b := (public.create_run(b,suite_b,'test:old','test:new',3,frozen)#>>'{run,id}')::uuid;
  perform set_config('m5.run_a',run_a::text,true);
  perform set_config('m5.run_b',run_b::text,true);
  perform pg_temp.assert_true(response#>>'{run,manifest,suite_sha256}' = repeat('a',64)
    and response#>>'{run,manifest,run_id}' = run_a::text and response#>>'{run,manifest,mode}' = 'live', 'server frozen identity');
  perform pg_temp.expect_error(format('select public.create_run(%L,%L,%L,%L,3,%L::jsonb)',
    a,suite_b,'test:old','test:new',frozen),'not_owner');
  perform pg_temp.expect_error(format('update public.runs set manifest = %L::jsonb where id=%L','{}',run_a),'immutable_run_snapshot');
  perform pg_temp.expect_error(format('update public.suites set body=%L::jsonb where id=%L','{}',suite_a),'immutable_record');
  perform pg_temp.expect_error(format('delete from public.suites where id=%L',suite_a),null,'23503');
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,4,.1,%L)',run_a,'task.one','old',gen_random_uuid()),'invalid_input');
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,.1,%L)',run_a,'missing.task','old',gen_random_uuid()),'invalid_input');
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,%L::numeric,%L)',run_a,'task.one','old','NaN',gen_random_uuid()),'invalid_input');
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,%L::numeric,%L)',run_a,'task.one','old','Infinity',gen_random_uuid()),'invalid_input');

  response := public.claim_and_reserve(run_a,'task.one','old',1,.4,req);
  attempt := (response->>'attempt_id')::uuid;
  replay := public.claim_and_reserve(run_a,'task.one','old',1,.9,req);
  perform pg_temp.assert_true(replay->>'outcome'='replay' and replay->>'attempt_id'=attempt::text
    and (select reserved_usd=.4 from public.budgets where owner_id=a), 'same request cannot double reserve even with changed estimate');
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,.1,%L)',run_a,'task.one','old',gen_random_uuid()),'in_flight');
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,.7,%L)',run_a,'task.one','new',gen_random_uuid()),'user_cap_exceeded');
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,1.7,%L)',run_b,'task.one','new',gen_random_uuid()),'global_cap_exceeded');
  delete from public.live_access where owner_id=b;
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,.1,%L)',run_b,'task.one','new',gen_random_uuid()),'no_live_access');
  insert into public.live_access(owner_id) values(b);
  update public.budgets set cap_usd=null where owner_id=b;
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,.1,%L)',run_b,'task.one','new',gen_random_uuid()),'cap_unset');
  update public.budgets set cap_usd=2,live_blocked=true,blocked_reason='fixture block' where owner_id=b;
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,.1,%L)',run_b,'task.one','new',gen_random_uuid()),'user_blocked');
  update public.budgets set live_blocked=false,blocked_reason=null where owner_id=b;
  update public.app_budget set global_cap_usd=null where id=1;
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,.1,%L)',run_b,'task.one','new',gen_random_uuid()),'deployment_blocked');
  update public.app_budget set global_cap_usd=2,live_blocked=true where id=1;
  perform pg_temp.expect_error(format('select public.claim_and_reserve(%L,%L,%L,1,.1,%L)',run_b,'task.one','new',gen_random_uuid()),'deployment_blocked');
  update public.app_budget set live_blocked=false where id=1;

  perform public.mark_dispatched(attempt);
  perform pg_temp.assert_true(public.mark_dispatched(attempt)->>'outcome'='replay', 'duplicate dispatch cannot authorize a new fetch');
  perform pg_temp.expect_error(format('select public.release_attempt(%L)',attempt),'invalid_transition');
  perform public.settle_attempt(attempt,.25);
  before_row := (select to_jsonb(x) from public.budgets x where owner_id=a);
  perform pg_temp.assert_true(public.settle_attempt(attempt,.25)->>'outcome'='replay', 'same amount settlement idempotent');
  perform pg_temp.expect_error(format('select public.settle_attempt(%L,.26)',attempt),'settlement_amount_mismatch');
  perform pg_temp.assert_true(before_row=(select to_jsonb(x) from public.budgets x where owner_id=a), 'repeat settlement leaves counters unchanged');
  insert into public.samples(owner_id,run_id,task_id,side,sample,normalised,output_sha256)
    values(a,run_a,'task.one','old',1,'{"text":"evidence"}',repeat('d',64));
  perform pg_temp.assert_true(public.claim_and_reserve(run_a,'task.one','old',1,.1,gen_random_uuid())->>'outcome'='sample_exists','stored sample never redispatches');
  perform pg_temp.assert_true(public.claim_and_reserve(run_a,'task.one','old',1,.1,req)->>'outcome'='replay','request replay takes precedence over sample');
  perform pg_temp.expect_error(format('update public.samples set error=%L where run_id=%L','changed',run_a),'immutable_record');
  perform pg_temp.expect_error(format('delete from public.samples where run_id=%L',run_a),'immutable_record');
  perform pg_temp.expect_error(format('insert into public.samples(owner_id,run_id,task_id,side,sample,error,output_sha256) values(%L,%L,%L,%L,1,%L,%L)',
    b,run_a,'task.one','new','foreign owner',repeat('e',64)),'invalid_input');

  unknown_attempt := (public.claim_and_reserve(run_a,'task.one','old',2,.2,gen_random_uuid())->>'attempt_id')::uuid;
  perform public.mark_dispatched(unknown_attempt);
  perform public.mark_unknown_liability(unknown_attempt);
  perform pg_temp.assert_true((select reserved_usd=.2 and spent_usd=.25 from public.budgets where owner_id=a)
    and (select reserved_usd=.2 from public.app_budget where id=1),'unknown liability retains both reserves');
  perform pg_temp.expect_error(format('select public.release_attempt(%L)',unknown_attempt),'invalid_transition');
  perform pg_temp.expect_error(format('select public.settle_attempt(%L,.1)',unknown_attempt),'invalid_transition');
  perform public.reconcile_attempt(unknown_attempt,null,'test:invoice','isolated-test','full reserve when unknown');
  perform pg_temp.expect_error(format('select public.reconcile_attempt(%L,null,%L,%L,%L)',unknown_attempt,'test:invoice','isolated-test','duplicate'),'invalid_transition');
  perform pg_temp.assert_true((select actual_usd=.2 and status='settled' from public.call_attempts where id=unknown_attempt)
    and (select count(*)=1 from public.ledger_audit where attempt_id=unknown_attempt),'single audited full-reserve reconciliation');
  perform pg_temp.expect_error('update public.ledger_audit set reason=''changed''','immutable_record');
  perform pg_temp.expect_error('delete from public.ledger_audit','immutable_record');

  attempt := (public.claim_and_reserve(run_a,'task.one','old',3,.2,gen_random_uuid())->>'attempt_id')::uuid;
  perform public.release_attempt(attempt);
  perform pg_temp.assert_true(public.release_attempt(attempt)->>'outcome'='replay','release replay cannot decrement twice');
  attempt := (public.claim_and_reserve(run_a,'task.one','new',1,.1,gen_random_uuid())->>'attempt_id')::uuid;
  perform public.mark_dispatched(attempt);
  response := public.settle_attempt(attempt,.2);
  perform pg_temp.assert_true(response->>'status'='overrun'
    and (select live_blocked and spent_usd=.65 and reserved_usd=0 from public.budgets where owner_id=a),'overrun recorded and user blocked');
  perform public.unblock_user(a,'verified synthetic invoice');
  perform pg_temp.assert_true((select not live_blocked and spent_usd=.65 from public.budgets where owner_id=a)
    and exists(select 1 from public.ledger_audit where action='unblock_user' and evidence_ref='owner:'||a::text),'unblock audited without forgiving spend');
  update public.app_budget set global_cap_usd=.7 where id=1;
  attempt := (public.claim_and_reserve(run_b,'task.one','new',1,.04,gen_random_uuid())->>'attempt_id')::uuid;
  perform public.mark_dispatched(attempt);
  perform public.settle_attempt(attempt,.1);
  perform pg_temp.assert_true((select live_blocked and spent_usd=.75 and reserved_usd=0 from public.app_budget where id=1),'global overrun blocks deployment');

  insert into public.rulings(owner_id,run_id,finding_id,kind,reason,created_at)
    values(a,run_a,repeat('f',64),'waived','test event','2026-01-01T00:00:00Z') returning id into ruling;
  insert into public.rulings(owner_id,run_id,finding_id,kind,reason,supersedes,created_at)
    values(a,run_a,repeat('f',64),'tombstone','test supersession',ruling,'2026-01-01T00:00:01Z') returning id into tombstone;
  perform pg_temp.expect_error(format('insert into public.rulings(owner_id,run_id,finding_id,kind,reason,supersedes) values(%L,%L,%L,%L,%L,%L)',
    a,run_a,repeat('e',64),'tombstone','wrong finding',ruling),'invalid_supersession');
  perform pg_temp.expect_error(format('insert into public.rulings(owner_id,run_id,finding_id,kind,reason,supersedes) values(%L,%L,%L,%L,%L,%L)',
    b,run_b,repeat('f',64),'tombstone','wrong owner',ruling),'invalid_supersession');
  perform pg_temp.expect_error(format('update public.rulings set reason=%L where id=%L','changed',ruling),'immutable_record');
  perform pg_temp.expect_error(format('delete from public.rulings where id=%L',tombstone),'immutable_record');

  update public.budgets set live_blocked=true,blocked_reason='cap setter must preserve' where owner_id=a;
end;
$$;

-- Real role and JWT-claim checks, rather than privileged queries that bypass RLS.
select set_config('request.jwt.claim.sub', current_setting('m5.owner_a'), true);
set local role authenticated;
do $$
declare v_cap jsonb;
begin
  if (select count(*) from public.runs) <> 1 or exists(
    select 1 from public.runs where id=current_setting('m5.run_b')::uuid
  ) then raise exception 'two-user RLS isolation failed'; end if;
  if exists(select 1 from public.samples where owner_id<>auth.uid()) then raise exception 'sample isolation failed'; end if;
  v_cap := public.set_my_cap(3);
  if v_cap->>'owner_id' <> auth.uid()::text or (v_cap->>'spent_usd')::numeric <> .65
    or (v_cap->>'reserved_usd')::numeric <> 0 or not (v_cap->>'live_blocked')::boolean
    or v_cap->>'blocked_reason' <> 'cap setter must preserve' then
    raise exception 'set_my_cap modified another field';
  end if;
  v_cap := public.set_my_cap(null);
  if v_cap->>'cap_usd' is not null then raise exception 'NULL cap must stay unset'; end if;
  begin perform public.set_my_cap('NaN'::numeric); raise exception 'NaN accepted';
    exception when sqlstate 'P0001' then if sqlerrm<>'invalid_input' then raise; end if; end;
  begin perform public.set_my_cap('Infinity'::numeric); raise exception 'Infinity accepted';
    exception when sqlstate 'P0001' then if sqlerrm<>'invalid_input' then raise; end if; end;
  begin perform public.set_my_cap('-Infinity'::numeric); raise exception '-Infinity accepted';
    exception when sqlstate 'P0001' then if sqlerrm<>'invalid_input' then raise; end if; end;
  begin perform public.set_my_cap(-1); raise exception 'negative cap accepted';
    exception when sqlstate 'P0001' then if sqlerrm<>'invalid_input' then raise; end if; end;
  begin perform public.release_attempt(gen_random_uuid()); raise exception 'service RPC exposed';
    exception when insufficient_privilege then null; end;
end;
$$;
reset role;

set local role anon;
do $$
begin
  begin perform public.set_my_cap(1); raise exception 'anon cap RPC exposed';
    exception when insufficient_privilege then null; end;
  begin perform 1 from public.suites; raise exception 'anon suites exposed';
    exception when insufficient_privilege then null; end;
end;
$$;
reset role;
rollback;
