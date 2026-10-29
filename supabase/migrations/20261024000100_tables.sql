-- Fresh Bolt Database target. No seeds, allowlist grants, prices or deployment cap.
create table public.suites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  suite_id uuid not null,
  suite_sha256 text not null check (suite_sha256 ~ '^[a-f0-9]{64}$'),
  old_model text not null check (length(btrim(old_model)) > 0),
  new_model text not null check (length(btrim(new_model)) > 0),
  k integer not null check (k in (1, 3, 5)),
  mode text not null default 'live' check (mode = 'live'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'running', 'paused', 'completed')),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (suite_id, owner_id) references public.suites(id, owner_id) on delete restrict
);

create table public.samples (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  run_id uuid not null,
  task_id text not null check (task_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  side text not null check (side in ('old', 'new')),
  sample integer not null check (sample in (1, 2, 3, 4, 5)),
  raw jsonb,
  normalised jsonb,
  output_sha256 text not null check (output_sha256 ~ '^[a-f0-9]{64}$'),
  error text check (error is null or length(btrim(error)) > 0),
  created_at timestamptz not null default now(),
  check ((normalised is not null and error is null) or (normalised is null and error is not null)),
  check (normalised is null or jsonb_typeof(normalised) = 'object'),
  unique (run_id, task_id, side, sample),
  foreign key (run_id, owner_id) references public.runs(id, owner_id) on delete restrict
);

create table public.rulings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  run_id uuid not null,
  finding_id text not null check (finding_id ~ '^[a-f0-9]{64}$'),
  kind text not null check (kind in ('confirmed', 'waived', 'retest', 'tombstone')),
  reason text not null check (length(btrim(reason)) > 0),
  supersedes uuid,
  created_at timestamptz not null default now(),
  check ((kind = 'tombstone') = (supersedes is not null)),
  check (supersedes is null or supersedes <> id),
  unique (id, owner_id),
  foreign key (run_id, owner_id) references public.runs(id, owner_id) on delete restrict,
  foreign key (supersedes, owner_id) references public.rulings(id, owner_id) on delete restrict
);

create table public.budgets (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  cap_usd numeric check (cap_usd >= 0 and cap_usd < 'Infinity'::numeric),
  reserved_usd numeric not null default 0 check (reserved_usd >= 0 and reserved_usd < 'Infinity'::numeric),
  spent_usd numeric not null default 0 check (spent_usd >= 0 and spent_usd < 'Infinity'::numeric),
  live_blocked boolean not null default false,
  blocked_reason text,
  check (not live_blocked or (blocked_reason is not null and length(btrim(blocked_reason)) > 0))
);

create table public.app_budget (
  id smallint primary key check (id = 1),
  global_cap_usd numeric check (global_cap_usd >= 0 and global_cap_usd < 'Infinity'::numeric),
  reserved_usd numeric not null default 0 check (reserved_usd >= 0 and reserved_usd < 'Infinity'::numeric),
  spent_usd numeric not null default 0 check (spent_usd >= 0 and spent_usd < 'Infinity'::numeric),
  live_blocked boolean not null default false
);

create table public.live_access (
  owner_id uuid primary key references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  note text
);

create table public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  run_id uuid not null,
  task_id text not null check (task_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  side text not null check (side in ('old', 'new')),
  sample integer not null check (sample in (1, 2, 3, 4, 5)),
  attempt_no integer not null check (attempt_no > 0),
  status text not null check (status in ('claimed', 'dispatched', 'settled', 'released', 'unknown_liability', 'overrun')),
  reserve_usd numeric not null check (reserve_usd >= 0 and reserve_usd < 'Infinity'::numeric),
  actual_usd numeric check (actual_usd >= 0 and actual_usd < 'Infinity'::numeric),
  provider text not null check (provider in ('anthropic', 'openai_compatible')),
  model text not null check (length(btrim(model)) > 0),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('settled', 'overrun')) = (actual_usd is not null)),
  check (status <> 'overrun' or actual_usd > reserve_usd),
  unique (run_id, task_id, side, sample, attempt_no),
  unique (run_id, task_id, side, sample, request_id),
  foreign key (run_id, owner_id) references public.runs(id, owner_id) on delete restrict
);

create table public.ledger_audit (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references public.call_attempts(id) on delete restrict,
  action text not null check (action in ('reconcile_attempt', 'unblock_user')),
  amount_usd numeric check (amount_usd >= 0 and amount_usd < 'Infinity'::numeric),
  evidence_ref text,
  operator text not null check (length(btrim(operator)) > 0),
  reason text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now(),
  check ((action = 'reconcile_attempt' and attempt_id is not null and amount_usd is not null
    and evidence_ref is not null and length(btrim(evidence_ref)) > 0)
    or (action = 'unblock_user' and attempt_id is null and amount_usd is null
    and evidence_ref is not null and length(btrim(evidence_ref)) > 0))
);

create unique index call_attempts_one_inflight on public.call_attempts (run_id, task_id, side, sample)
  where status in ('claimed', 'dispatched');
create index suites_owner on public.suites(owner_id);
create index runs_owner on public.runs(owner_id);
create index samples_owner on public.samples(owner_id);
create index samples_run on public.samples(run_id);
create index rulings_owner on public.rulings(owner_id);
create index rulings_run on public.rulings(run_id);
create index call_attempts_owner on public.call_attempts(owner_id);
create index call_attempts_run on public.call_attempts(run_id);
create index ledger_audit_attempt on public.ledger_audit(attempt_id);
