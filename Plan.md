# DERConnect — Inverter Test Analysis Platform

## Context

We are building **DERConnect**, an internal web app for a small engineering team to upload CSV exports from FDR (Fault Data Recorder) cards on three EG4 FlexBOSS18 inverters and explore power, voltage, current, THD, and PMU metrics interactively.

The repository at `/home/user/CSV_Analytics` is currently empty. This plan establishes the full Next.js 14 + Supabase Pro stack from zero through a launchable MVP, with a clear path to two follow-on phases.

**Why this plan over the user's draft:**
- The draft assumed POSTing 500 MB files to a Next.js API route. Vercel's 4.5 MB body limit and 60–300 s timeout make that unworkable. We move uploads **direct browser → Supabase Storage** via signed URLs, with async processing.
- Real-world files are ≤ 50 MB so far (per user), which makes the processor choice less constrained, but we still pick a managed background job runner (Inngest) for retries, observability, and headroom.
- Keep raw CSV as the source of truth in Supabase Storage; persist only **decimated samples + 1 s aggregates + FFT summaries** in Postgres. Faster queries, cheaper storage.
- TimescaleDB hypertables are available on Supabase Pro (per user) — schema uses them where they help (`samples_decimated`, `pmu_samples`). Native partitioning is the documented fallback if the extension is unavailable.

---

## Architecture

```
Browser (Next.js 14 on Vercel)
  ├─ Upload UI: PapaParse client preview + schema sniff
  ├─ Auth: Supabase JS (Google OAuth + magic link)
  ├─ Charts: uPlot (time series), Plotly (FFT)
  └─ Realtime: subscribes to ingest_jobs status
       │
       │  1. POST /api/uploads/sign  → signed Storage URL + sessions row
       │  2. PUT raw CSV  → Supabase Storage (resumable for >5 MB)
       │  3. POST /api/ingest/start  → emits Inngest event
       │  4. Realtime: ingest_jobs.status updates
       │  5. GET /api/sessions/:id/series  → downsampled chart data
       ▼
Supabase (Postgres + Auth + Storage + Realtime)
  ├─ tables: sessions, inverters, session_inverters, ingest_jobs,
  │          window_metrics_1s, fft_results, quality_flags
  ├─ hypertables (timescaledb): samples_decimated, pmu_samples
  ├─ buckets: raw/{sessionId}/original.csv, derived/{sessionId}/fft.parquet
  └─ RLS: shared team workspace (any authenticated user)
       ▲
       │ service-role writes
       │
Inngest (managed background jobs)
  └─ ingest.csv.uploaded step function
        1. stream-download CSV from Storage
        2. stream-parse via csv-parse
        3. detect format, decimate to ~10 Hz
        4. compute 1 s window aggregates
        5. compute FFT/THD per (inverter,phase,V/I,window)
        6. compute PMU metrics + quality flags
        7. batch upsert into Postgres
        8. write fft.parquet to Storage
        9. mark ingest_jobs.status='complete'
```

The 500 MB hypothetical (and the 50 MB real) CSV never traverses a Next.js API route. API routes only carry small JSON.

---

## Phased rollout

**Phase 1 — MVP (launchable).** Auth + RLS, upload wizard, ingest one canonical CSV format, session list, single-session viewer with Power / Voltage / Current / THD time-series charts and a summary stats table.

**Phase 2.** FFT spectrum view, PMU 2×2 grid, quality flags surfaced in UI, multi-format CSV detection, re-process button.

**Phase 3.** Session comparison (overlay 2–4 sessions), CSV export of derived metrics, on-demand raw-sample slice fetch from Storage, threshold alerting.

Schema in Section "Database" already accommodates Phases 2–3 — no migrations needed to add those features.

---

## Database schema

All migrations live in `supabase/migrations/`. **Verify first**: run `create extension if not exists timescaledb;` on the project. If it fails (extension not allowlisted), switch the two `create_hypertable(...)` calls to declarative `partition by hash (session_id)` with 16 partitions — same query patterns work.

### Reference & metadata
```sql
create table inverters (
  id uuid primary key default gen_random_uuid(),
  serial text unique not null,
  model text default 'EG4 FlexBOSS18',
  notes text,
  created_at timestamptz default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  test_type text,                  -- 'load_step' | 'thd_sweep' | 'staircase' | ...
  sample_rate_hz numeric not null, -- 10..3000
  start_ts timestamptz,
  end_ts timestamptz,
  duration_s numeric generated always as
    (extract(epoch from (end_ts - start_ts))) stored,
  storage_path text not null,      -- raw/{id}/original.csv
  fft_path text,                   -- derived/{id}/fft.parquet
  row_count bigint,
  quality_summary jsonb,           -- {clean|issues|limited, counts...}
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);
create index on sessions (created_at desc);

create table session_inverters (
  session_id uuid references sessions(id) on delete cascade,
  inverter_id uuid references inverters(id),
  role text,
  primary key (session_id, inverter_id)
);

create table ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  status text not null default 'pending',  -- pending|parsing|computing|writing|complete|failed
  progress int default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz
);
alter publication supabase_realtime add table ingest_jobs;
```

### Time-series (hypertables)
```sql
create table samples_decimated (
  session_id uuid not null,
  inverter_id uuid not null,
  phase smallint not null,         -- 0=A, 1=B, 2=C
  ts timestamptz not null,
  voltage_rms real, current_rms real,
  power_w real, power_factor real,
  freq_hz real,
  thd_v_pct real, thd_i_pct real
);
select create_hypertable('samples_decimated', 'ts',
  chunk_time_interval => interval '1 day');
create index on samples_decimated (session_id, ts desc);

create table pmu_samples (
  session_id uuid not null,
  inverter_id uuid not null,
  phase smallint not null,
  ts timestamptz not null,
  magnitude real,
  angle_rad real,
  freq_hz real,
  rocof real
);
select create_hypertable('pmu_samples', 'ts',
  chunk_time_interval => interval '1 day');
create index on pmu_samples (session_id, ts desc);
```

### Aggregates and FFT
```sql
create table window_metrics_1s (
  session_id uuid not null,
  inverter_id uuid not null,
  phase smallint not null,
  window_start timestamptz not null,
  v_rms_mean real, v_rms_min real, v_rms_max real,
  i_rms_mean real, i_rms_min real, i_rms_max real,
  power_mean_w real, power_min_w real, power_max_w real,
  pf_mean real,
  freq_mean_hz real, freq_min_hz real, freq_max_hz real,
  thd_v_pct real, thd_i_pct real,
  imbalance_pct real,
  sample_count int,
  primary key (session_id, inverter_id, phase, window_start)
);
create index on window_metrics_1s (session_id, window_start);

create table fft_results (
  session_id uuid not null,
  inverter_id uuid not null,
  phase smallint not null,
  window_start timestamptz not null,
  signal_kind text not null,       -- 'voltage' | 'current'
  fundamental_hz real,
  thd_pct real,
  harmonics_jsonb jsonb,           -- top 20 bins inline for fast rendering
  parquet_offset bigint,           -- byte offset into derived/{id}/fft.parquet
  primary key (session_id, inverter_id, phase, window_start, signal_kind)
);

create table quality_flags (
  id bigserial primary key,
  session_id uuid not null,
  ts_start timestamptz, ts_end timestamptz,
  inverter_id uuid, phase smallint,
  code text not null,              -- 'voltage_sag'|'clip'|'gap'|'overrange'|'imbalance'|'high_thd'
  severity smallint,               -- 1=info, 2=warning, 3=alert
  details jsonb
);
create index on quality_flags (session_id);
```

### RLS (shared team workspace)
```sql
alter table sessions enable row level security;
create policy team_read on sessions for select using (auth.role() = 'authenticated');
create policy team_write on sessions for all using (auth.role() = 'authenticated');
-- Repeat the same policies for: inverters, session_inverters, ingest_jobs,
-- samples_decimated, pmu_samples, window_metrics_1s, fft_results, quality_flags.
```

Storage buckets `raw` and `derived` are private; access is gated through signed URLs minted by authenticated server routes.

---

## CSV ingestion pipeline

1. **Client preview** (`components/upload/UploadWizard.tsx`): PapaParse with `preview: 100` reads headers, sniffs sample rate from the first 1000 rows, surfaces detected inverter count + phases, and lets the user fix column mappings if FDR firmware varies.
2. **Mint signed URL** (`POST /api/uploads/sign`): inserts a `sessions` row with `status='pending'`, calls `supabase.storage.from('raw').createSignedUploadUrl(path)`, returns `{ sessionId, signedUrl }`.
3. **Direct upload**: browser PUTs to the signed URL. For files > 5 MB, use `@supabase/storage-js` resumable upload (TUS) so a flaky connection doesn't lose progress.
4. **Trigger ingest** (`POST /api/ingest/start`): inserts `ingest_jobs` row, emits Inngest event `csv/uploaded` with `{ sessionId, storagePath }`, returns immediately.
5. **Live status**: browser subscribes via `supabase.channel().on('postgres_changes', { table: 'ingest_jobs', filter: \`session_id=eq.${id}\` })` for the progress bar.
6. **Worker runs** (Section "Background processing"): updates `ingest_jobs.status` and `progress` between steps; on `status='complete'` the viewer becomes available.

**Validation rules** (reject upload, show specific message):
- Sample rate < 10 Hz or > 3000 Hz → "unsupported sample rate"
- Missing required column (any of voltage/current per declared inverter+phase) → list missing columns
- Non-numeric data in the first 100 rows of voltage/current columns → "non-numeric data detected at row N"

---

## Background processing — Inngest

**Choice**: Inngest, deployed alongside Next.js as a single `/api/inngest` webhook route.

Why:
- Step functions with automatic retries per step
- No Vercel 300 s ceiling (Inngest's runtime executes the work, only calling back to claim steps)
- Observability dashboard included
- Generous free tier
- Stays TypeScript end-to-end, no second deploy target

Alternatives evaluated and rejected:
- **Supabase Edge Functions**: 150 s timeout + 256 MB memory; viable for 50 MB files today but no headroom for the 3 kHz / 500 MB ceiling, and weak observability
- **Cloud Run / Render worker**: have to build queue, retries, dashboard, dead-letter handling ourselves
- **Trigger.dev**: comparable; Inngest wins on Vercel ergonomics

**Function shape** (`inngest/functions/ingestCsv.ts`):
```ts
inngest.createFunction(
  { id: 'ingest-csv', concurrency: 4 },
  { event: 'csv/uploaded' },
  async ({ event, step }) => {
    const { sessionId, storagePath } = event.data;
    const blob = await step.run('download', () => downloadFromStorage(storagePath));
    const parsed = await step.run('parse', () => streamParse(blob));      // detects format, decimates to 10 Hz
    const windows = await step.run('windows', () => computeWindows(parsed)); // 1s aggregates
    const ffts = await step.run('ffts', () => computeFFTs(parsed));         // per-phase, per-window
    const flags = await step.run('quality', () => detectFlags(parsed, windows));
    await step.run('write-db', () => batchInsert({ windows, ffts, flags }));
    await step.run('write-parquet', () => writeFftParquet(sessionId, ffts));
    await step.run('finalize', () => markComplete(sessionId));
  }
);
```

The Inngest function uses the **service-role key** (server-only env var) to bypass RLS for bulk inserts.

---

## Signal processing — `lib/dsp/`

Pure TypeScript, runs inside the Inngest function. No native deps.

| Module | Purpose | Library |
|---|---|---|
| `parse.ts` | Stream-parse CSV row by row | `csv-parse` (sync stream API) |
| `decimate.ts` | Block-mean to ~10 Hz for storage | (none) |
| `windows.ts` | 1 s aggregates (mean/min/max/RMS), per-phase imbalance | (none) |
| `fft.ts` | Radix-2 FFT, 4096-pt windows | `fft.js` (Indutny) — fastest pure-JS FFT |
| `thd.ts` | THD = √Σ(H_k²) / H_1 × 100, k≥2 | derived from `fft.ts` |
| `pmu.ts` | Magnitude/angle from fundamental bin, freq from interp peak, ROCOF from Δfreq/Δt | derived from `fft.ts` |
| `quality.ts` | Sag, clip, gap, imbalance, high-THD, freq-deviation flags | (none) |
| `lttb.ts` | Server-side downsampling for chart endpoints | port of LTTB algorithm |

DB writes batched in 5000-row chunks via `supabase-js`. If insert throughput becomes a bottleneck, expose a Postgres function that wraps `COPY ... FROM STDIN` and call it via RPC.

Cap FFT window to 1 s of samples (worst case 3000 → next pow2 = 4096) to keep memory bounded.

---

## Chart libraries

- **Time series** (Power, V, I, THD, PMU sub-charts): **uPlot**. Recharts dies past ~10k points; uPlot handles 1M+ at 60 fps. Wrap in `components/charts/TimeSeries.tsx`.
- **FFT spectrum**: **Plotly** (`react-plotly.js`, basic bundle, lazy-loaded with `next/dynamic({ ssr: false })`). Spectrum + log axis + hover for free.
- **Summary stats**: TanStack Table — no chart, just color-coded cells for warning/alert thresholds.
- **Comparison view (Phase 3)**: same uPlot component, multi-series with per-session color.

All chart endpoints return LTTB-downsampled data (`?points=2000` default) so payloads stay under ~100 KB. Zoom triggers a finer-grained refetch.

**Color conventions** (per user spec): Ph A `#E53935`, Ph B `#1E88E5`, Ph C `#43A047`. Inv1 solid, Inv2 dashed, Inv3 dotted. Dark mode via Tailwind's `dark:` classes; uPlot themed via CSS vars.

---

## Auth & permissions

- **Provider**: Supabase Auth — Google OAuth (primary) + email magic link (fallback)
- **Allowlist**: `allowed_emails` table or `auth.users` trigger checking domain. Adds a check in RLS via `is_team_member(auth.uid())`.
- **Model**: shared workspace; every authenticated team member can read and write everything (per user requirement)
- **Service-role key**: only set on Vercel as a server-side env var (never `NEXT_PUBLIC_`); only the Inngest function and admin server routes use it
- **Inngest webhook**: signature verified via `INNGEST_SIGNING_KEY`

---

## Project structure

```
/home/user/CSV_Analytics/
├─ app/
│  ├─ layout.tsx
│  ├─ page.tsx                              # dashboard / session list
│  ├─ upload/page.tsx                       # upload wizard
│  ├─ sessions/[id]/page.tsx                # main viewer
│  ├─ sessions/[id]/compare/page.tsx        # Phase 3
│  └─ api/
│     ├─ uploads/sign/route.ts              # mint signed URL + create session
│     ├─ ingest/start/route.ts              # emit Inngest event
│     ├─ sessions/route.ts                  # list
│     ├─ sessions/[id]/route.ts             # metadata
│     ├─ sessions/[id]/series/route.ts      # decimated + LTTB
│     ├─ sessions/[id]/metrics/route.ts     # 1s window aggregates
│     ├─ sessions/[id]/pmu/route.ts
│     ├─ sessions/[id]/harmonics/route.ts   # FFT bins from parquet
│     ├─ sessions/[id]/events/route.ts
│     ├─ sessions/[id]/export/route.ts      # CSV download
│     └─ inngest/route.ts                   # Inngest webhook
├─ components/
│  ├─ charts/{TimeSeries,FFTSpectrum,PMUGrid,StatsTable}.tsx
│  ├─ upload/{UploadWizard,SchemaPreview,ProgressBar}.tsx
│  ├─ sessions/{SessionTable,SessionFilters,EventOverlay}.tsx
│  └─ ui/{Button,Card,Badge,Skeleton}.tsx
├─ lib/
│  ├─ supabase/{client,server,admin}.ts     # admin = service-role, server-only
│  └─ dsp/{parse,decimate,windows,fft,thd,pmu,quality,lttb}.ts
├─ inngest/
│  ├─ client.ts
│  └─ functions/ingestCsv.ts
├─ supabase/migrations/
│  ├─ 0001_init.sql                         # tables + hypertables
│  ├─ 0002_rls.sql
│  └─ 0003_realtime.sql
├─ scripts/
│  └─ gen-csv.ts                            # synthetic CSV generator for tests
├─ types/{csv.ts,db.ts}                     # db.ts generated from Supabase
├─ package.json
├─ next.config.mjs
├─ tailwind.config.ts
├─ tsconfig.json
└─ .env.local.example
```

Key dependencies:
```
next, react, typescript, tailwindcss
@supabase/supabase-js, @supabase/ssr
inngest
papaparse                       # client preview
csv-parse                       # server stream parse
fft.js
parquetjs-lite                  # write FFT bin sidecar
uplot, react-uplot
react-plotly.js, plotly.js-basic-dist
@tanstack/react-table
zustand                         # client filter state
zod                             # validation
```

---

## Verification plan

1. **Synthetic CSV generator** (`scripts/gen-csv.ts`): emits clean three-phase sinusoids at configurable Hz with optional injected harmonics, sags, gaps. Generate fixtures `10hz_60s.csv` (~10 KB), `1khz_60s.csv` (~10 MB), `3khz_100s.csv` (~50 MB).
2. **Local dev loop**: `supabase start` (local Postgres + Storage), `npx inngest-cli dev`, `npm run dev` — all on localhost.
3. **End-to-end checks**:
   - Upload `10hz_60s.csv` → ingest_jobs reaches `complete` in < 5 s, viewer renders Power/V/I/THD charts and summary stats.
   - Upload `3khz_100s.csv` → resumable upload survives a forced network drop, Inngest job completes in < 60 s, FFT parquet written, charts render in < 1 s with payload < 200 KB.
   - Inject 100 ms voltage sag → `quality_flags` row with `code='voltage_sag'`, badge appears in UI.
   - Inject 5% 5th harmonic → THD reading within 0.2% of analytical value.
   - Forced parsing failure → ingest_jobs.status='failed', error surfaced to UI, no orphan rows in `samples_decimated`.
4. **Performance budgets**: `/api/sessions/:id/series` p95 < 300 ms, viewer FCP < 1.5 s on cable, Inngest job for 50 MB < 30 s.
5. **RLS regression**: logged-out client gets 401 on every API route and Storage path.

---

## Risks & tradeoffs

- **TimescaleDB extension availability** — verify `create extension timescaledb;` on the user's project before applying migration `0001`. Fallback already designed: declarative hash partitioning by `session_id` with 16 partitions.
- **Postgres insert throughput** — naive PostgREST inserts cap around 500 rows/s. Mitigate with 5000-row batches; escalate to a `COPY`-wrapping RPC if needed.
- **fft.js memory** — cap windows at 1 s of samples (≤ 4096-pt FFT). Larger windows would balloon heap.
- **CSV format drift** — FDR firmware versions differ. Phase 1 supports one canonical format and rejects unknowns with a clear error; Phase 2 adds a parser registry and column-mapping persistence.
- **Plotly bundle size** (~3 MB) — lazy-load only on viewer pages via `next/dynamic`.
- **Inngest cold starts** — 10–20 s on first job after idle; acceptable for an internal tool, document it.
- **Service-role key handling** — only as a Vercel server-side env var; verified Inngest signatures prevent unauthorized job triggers.
- **Browser memory on raw download** (Phase 3) — never download the full CSV; use a slice endpoint that re-reads from Storage and returns only the requested time range.

---

## Effort estimates

| Phase | Scope | Days |
|---|---|---|
| Phase 1 (MVP) | Scaffold, Supabase setup + migrations, auth + RLS, signed-URL upload, Inngest pipeline for one CSV format, decimation + 1s windows, dashboard + viewer with Power/V/I/THD + stats table | **12–16** |
| Phase 2 | FFT + parquet, FFT spectrum view, PMU 2×2 grid, quality flags UI, multi-format detection, re-process button | **8–12** |
| Phase 3 | Comparison overlay, CSV export, on-demand raw slice, threshold alerts | **6–8** |
| Buffer | Bug fix, perf tuning on real files, docs, onboarding | **4–6** |
| **Total** | | **~30–42** |

A single engineer can ship Phase 1 in roughly three focused weeks; the team becomes useful immediately.

---

## Critical files to create first (Phase 1 implementation order)

1. `package.json` + `next.config.mjs` + `tsconfig.json` + `tailwind.config.ts` — scaffold
2. `.env.local.example` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
3. `supabase/migrations/0001_init.sql` (after verifying timescaledb extension)
4. `supabase/migrations/0002_rls.sql`
5. `lib/supabase/{client,server,admin}.ts`
6. `app/layout.tsx` + `app/page.tsx` + auth UI
7. `app/api/uploads/sign/route.ts`
8. `components/upload/UploadWizard.tsx`
9. `inngest/client.ts` + `inngest/functions/ingestCsv.ts` + `app/api/inngest/route.ts`
10. `lib/dsp/{parse,decimate,windows,quality}.ts` (defer `fft,thd,pmu` to Phase 2)
11. `app/api/sessions/[id]/series/route.ts` + `lib/dsp/lttb.ts`
12. `components/charts/TimeSeries.tsx` (uPlot)
13. `app/sessions/[id]/page.tsx` — viewer
14. `scripts/gen-csv.ts` — for end-to-end tests
