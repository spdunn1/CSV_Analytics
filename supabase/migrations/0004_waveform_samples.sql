-- Raw instantaneous waveform samples (3 kHz FDR exports).
-- One row per (session, inverter, phase, timestamp).
-- Queries always filter by session_id + ts range, so ts is the partitioning axis.

create table waveform_samples (
  session_id  uuid        not null,
  inverter_id uuid        not null,
  phase       smallint    not null,  -- 0=A, 1=B, 2=C
  ts          timestamptz not null,
  voltage     real,                  -- instantaneous V (signed)
  current     real                   -- instantaneous A (signed)
);

select create_hypertable(
  'waveform_samples', 'ts',
  chunk_time_interval => interval '1 hour'
);

create index on waveform_samples (session_id, ts asc);
create index on waveform_samples (session_id, phase, ts asc);
