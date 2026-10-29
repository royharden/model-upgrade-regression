-- Policy scope is deliberately narrower than the service-role ledger interface.
alter table public.suites enable row level security;
alter table public.runs enable row level security;
alter table public.samples enable row level security;
alter table public.rulings enable row level security;
alter table public.budgets enable row level security;
alter table public.app_budget enable row level security;
alter table public.live_access enable row level security;
alter table public.ledger_audit enable row level security;
alter table public.call_attempts enable row level security;

create policy suites_select_own on public.suites for select to authenticated
  using (owner_id = (select auth.uid()));
create policy suites_insert_own on public.suites for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy suites_delete_own on public.suites for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy runs_select_own on public.runs for select to authenticated
  using (owner_id = (select auth.uid()));
create policy samples_select_own on public.samples for select to authenticated
  using (owner_id = (select auth.uid()));

create policy rulings_select_own on public.rulings for select to authenticated
  using (owner_id = (select auth.uid()));
create policy rulings_insert_own on public.rulings for insert to authenticated
  with check (owner_id = (select auth.uid()) and exists (
    select 1 from public.runs r where r.id = run_id and r.owner_id = (select auth.uid())
  ));

create policy budgets_select_own on public.budgets for select to authenticated
  using (owner_id = (select auth.uid()));
create policy call_attempts_select_own on public.call_attempts for select to authenticated
  using (owner_id = (select auth.uid()));

-- app_budget, live_access and ledger_audit intentionally have no client policy.
-- runs, samples and accounting state have no authenticated mutation policy.
