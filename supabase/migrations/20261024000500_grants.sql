-- Never depend on Supabase's public-schema default privileges.
revoke all privileges on table public.suites, public.runs, public.samples, public.rulings,
  public.budgets, public.app_budget, public.live_access, public.ledger_audit, public.call_attempts
  from public, anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant select, insert, delete on table public.suites to authenticated;
grant select on table public.runs, public.samples, public.budgets, public.call_attempts to authenticated;
grant select, insert on table public.rulings to authenticated;
grant select, insert, update, delete on table public.suites, public.runs, public.samples, public.rulings,
  public.budgets, public.app_budget, public.live_access, public.ledger_audit, public.call_attempts to service_role;

revoke all on function public.reject_immutable_change() from public, anon, authenticated;
revoke all on function public.guard_run_snapshot() from public, anon, authenticated;
revoke all on function public.guard_attempt_identity() from public, anon, authenticated;
revoke all on function public.guard_ruling_supersession() from public, anon, authenticated;
revoke all on function public.guard_sample_key() from public, anon, authenticated;

revoke all on function public.create_run(uuid, uuid, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.claim_and_reserve(uuid, text, text, integer, numeric, uuid) from public, anon, authenticated;
revoke all on function public.mark_dispatched(uuid) from public, anon, authenticated;
revoke all on function public.settle_attempt(uuid, numeric) from public, anon, authenticated;
revoke all on function public.release_attempt(uuid) from public, anon, authenticated;
revoke all on function public.mark_unknown_liability(uuid) from public, anon, authenticated;
revoke all on function public.reconcile_attempt(uuid, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.unblock_user(uuid, text) from public, anon, authenticated;
revoke all on function public.set_my_cap(numeric) from public, anon, authenticated, service_role;

grant execute on function public.create_run(uuid, uuid, text, text, integer, jsonb) to service_role;
grant execute on function public.claim_and_reserve(uuid, text, text, integer, numeric, uuid) to service_role;
grant execute on function public.mark_dispatched(uuid) to service_role;
grant execute on function public.settle_attempt(uuid, numeric) to service_role;
grant execute on function public.release_attempt(uuid) to service_role;
grant execute on function public.mark_unknown_liability(uuid) to service_role;
grant execute on function public.reconcile_attempt(uuid, numeric, text, text, text) to service_role;
grant execute on function public.unblock_user(uuid, text) to service_role;
grant execute on function public.set_my_cap(numeric) to authenticated;
