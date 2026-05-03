-- DERConnect: Row-Level Security
-- Shared team workspace: any authenticated user can read and write everything.

-- ─── Helper: is the request authenticated? ───────────────────────────────────
-- (Simple version — swap for domain-check or allowed_emails table if needed)

-- ─── inverters ───────────────────────────────────────────────────────────────
alter table inverters enable row level security;
create policy "team_all" on inverters for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── sessions ────────────────────────────────────────────────────────────────
alter table sessions enable row level security;
create policy "team_all" on sessions for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── session_inverters ───────────────────────────────────────────────────────
alter table session_inverters enable row level security;
create policy "team_all" on session_inverters for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── ingest_jobs ─────────────────────────────────────────────────────────────
alter table ingest_jobs enable row level security;
create policy "team_all" on ingest_jobs for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ─── samples_decimated ───────────────────────────────────────────────────────
alter table samples_decimated enable row level security;
create policy "team_read" on samples_decimated for select
  using (auth.role() = 'authenticated');
-- Writes come from the Inngest worker via service-role (bypasses RLS)

-- ─── window_metrics_1s ───────────────────────────────────────────────────────
alter table window_metrics_1s enable row level security;
create policy "team_read" on window_metrics_1s for select
  using (auth.role() = 'authenticated');

-- ─── fft_results ─────────────────────────────────────────────────────────────
alter table fft_results enable row level security;
create policy "team_read" on fft_results for select
  using (auth.role() = 'authenticated');

-- ─── pmu_samples ─────────────────────────────────────────────────────────────
alter table pmu_samples enable row level security;
create policy "team_read" on pmu_samples for select
  using (auth.role() = 'authenticated');

-- ─── quality_flags ───────────────────────────────────────────────────────────
alter table quality_flags enable row level security;
create policy "team_read" on quality_flags for select
  using (auth.role() = 'authenticated');

-- ─── test_events ─────────────────────────────────────────────────────────────
alter table test_events enable row level security;
create policy "team_all" on test_events for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
