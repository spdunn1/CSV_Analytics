-- DERConnect: Initial schema
-- NOTE: Run `create extension if not exists timescaledb cascade;` first.
-- If timescaledb is not available, replace the two create_hypertable() calls
-- with declarative PARTITION BY HASH (session_id) with 16 partitions.

create extension if not exists timescaledb cascade;

-- ─── Reference tables ────────────────────────────────────────────────────────

create table inverters (
  id         uuid primary key default gen_random_uuid(),
  serial     text unique not null,
  model      text not null default 'EG4 FlexBOSS18',
  notes      text,
  created_at timestamptz not null default now()
);

create table sessions (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  test_type        text,          -- 'load_step' | 'thd_sweep' | 'staircase' | ...
  sample_rate_hz   numeric not null,
  start_ts         timestamptz,
  end_ts           timestamptz,
  duration_s       numeric generated always as
                     (extract(epoch from (end_ts - start_ts))) stored,
  storage_path     text not null, -- raw/{id}/original.csv
  fft_path         text,          -- derived/{id}/fft.parquet
  row_count        bigint,
  quality_summary  jsonb,         -- {status:'clean'|'issues'|'limited', counts:{...}}
  ingest_status    text not null default 'pending',
  created_by       uuid references auth.users(id),
  created_at       timestamptz not null default now()
);

create index on sessions (created_at desc);
create index on sessions (created_by);

create table session_inverters (
  session_id  uuid not null references sessions(id) on delete cascade,
  inverter_id uuid not null references inverters(id),
  role        text,
  primary key (session_id, inverter_id)
);

-- ─── Job tracking (Realtime enabled in 0003) ─────────────────────────────────

create table ingest_jobs (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  status      text not null default 'pending',
  -- 'pending' | 'downloading' | 'parsing' | 'computing' | 'writing' | 'complete' | 'failed'
  progress    int not null default 0, -- 0..100
  error       text,
  started_at  timestamptz,
  finished_at timestamptz
);

create index on ingest_jobs (session_id);

-- ─── Time-series: decimated samples (~10 Hz) ─────────────────────────────────

create table samples_decimated (
  session_id   uuid        not null,
  inverter_id  uuid        not null,
  phase        smallint    not null,  -- 0=A, 1=B, 2=C
  ts           timestamptz not null,
  voltage_rms  real,
  current_rms  real,
  power_w      real,
  power_factor real,
  freq_hz      real,
  thd_v_pct    real,
  thd_i_pct    real
);

select create_hypertable(
  'samples_decimated', 'ts',
  chunk_time_interval => interval '1 day'
);

create index on samples_decimated (session_id, ts desc);
create index on samples_decimated (session_id, inverter_id, phase, ts desc);

-- ─── 1-second window aggregates ──────────────────────────────────────────────

create table window_metrics_1s (
  session_id    uuid        not null,
  inverter_id   uuid        not null,
  phase         smallint    not null,
  window_start  timestamptz not null,
  v_rms_mean    real, v_rms_min  real, v_rms_max  real,
  i_rms_mean    real, i_rms_min  real, i_rms_max  real,
  power_mean_w  real, power_min_w real, power_max_w real,
  pf_mean       real,
  freq_mean_hz  real, freq_min_hz real, freq_max_hz real,
  thd_v_pct     real,
  thd_i_pct     real,
  imbalance_pct real,
  sample_count  int,
  primary key (session_id, inverter_id, phase, window_start)
);

create index on window_metrics_1s (session_id, window_start);

-- ─── FFT results ─────────────────────────────────────────────────────────────

create table fft_results (
  session_id      uuid        not null,
  inverter_id     uuid        not null,
  phase           smallint    not null,
  window_start    timestamptz not null,
  signal_kind     text        not null,  -- 'voltage' | 'current'
  fundamental_hz  real,
  thd_pct         real,
  harmonics_jsonb jsonb,                 -- top 20 bins inline [{n:1,mag:120.3,...}]
  parquet_offset  bigint,
  primary key (session_id, inverter_id, phase, window_start, signal_kind)
);

create index on fft_results (session_id, window_start);

-- ─── PMU samples (hypertable) ────────────────────────────────────────────────

create table pmu_samples (
  session_id  uuid        not null,
  inverter_id uuid        not null,
  phase       smallint    not null,
  ts          timestamptz not null,
  magnitude   real,
  angle_rad   real,
  freq_hz     real,
  rocof       real  -- df/dt Hz/s
);

select create_hypertable(
  'pmu_samples', 'ts',
  chunk_time_interval => interval '1 day'
);

create index on pmu_samples (session_id, ts desc);

-- ─── Quality flags ───────────────────────────────────────────────────────────

create table quality_flags (
  id          bigserial primary key,
  session_id  uuid     not null,
  ts_start    timestamptz,
  ts_end      timestamptz,
  inverter_id uuid,
  phase       smallint,
  code        text     not null,
  -- 'voltage_sag' | 'clip' | 'gap' | 'overrange' | 'imbalance' | 'high_thd' | 'freq_deviation'
  severity    smallint not null default 2,  -- 1=info, 2=warning, 3=alert
  details     jsonb
);

create index on quality_flags (session_id);
create index on quality_flags (session_id, code);

-- ─── Test events (optional annotations) ──────────────────────────────────────

create table test_events (
  id         bigserial primary key,
  session_id uuid        not null references sessions(id) on delete cascade,
  ts         timestamptz not null,
  label      text        not null,
  type       text,  -- 'step' | 'spike' | 'oscillation' | 'anomaly'
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index on test_events (session_id, ts);
