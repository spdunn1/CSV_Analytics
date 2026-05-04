// Auto-generated from Supabase — run `npm run supabase:types` to regenerate.
// This is a minimal hand-written skeleton until the project connects to a live instance.

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      inverters: {
        Row: {
          id: string;
          serial: string;
          model: string;
          notes: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['inverters']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['inverters']['Insert']>;
      };
      sessions: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          test_type: string | null;
          sample_rate_hz: number;
          start_ts: string | null;
          end_ts: string | null;
          duration_s: number | null;
          storage_path: string;
          fft_path: string | null;
          row_count: number | null;
          quality_summary: Json | null;
          ingest_status: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database['public']['Tables']['sessions']['Row'],
          'id' | 'created_at' | 'duration_s'
        > & { id?: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['sessions']['Insert']>;
      };
      ingest_jobs: {
        Row: {
          id: string;
          session_id: string;
          status: string;
          progress: number;
          error: string | null;
          started_at: string | null;
          finished_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['ingest_jobs']['Row'], 'id'> & { id?: string };
        Update: Partial<Database['public']['Tables']['ingest_jobs']['Insert']>;
      };
      samples_decimated: {
        Row: {
          session_id: string;
          inverter_id: string;
          phase: number;
          ts: string;
          voltage_rms: number | null;
          current_rms: number | null;
          power_w: number | null;
          power_factor: number | null;
          freq_hz: number | null;
          thd_v_pct: number | null;
          thd_i_pct: number | null;
        };
        Insert: Database['public']['Tables']['samples_decimated']['Row'];
        Update: Partial<Database['public']['Tables']['samples_decimated']['Row']>;
      };
      window_metrics_1s: {
        Row: {
          session_id: string;
          inverter_id: string;
          phase: number;
          window_start: string;
          v_rms_mean: number | null;
          v_rms_min: number | null;
          v_rms_max: number | null;
          i_rms_mean: number | null;
          i_rms_min: number | null;
          i_rms_max: number | null;
          power_mean_w: number | null;
          power_min_w: number | null;
          power_max_w: number | null;
          pf_mean: number | null;
          freq_mean_hz: number | null;
          freq_min_hz: number | null;
          freq_max_hz: number | null;
          thd_v_pct: number | null;
          thd_i_pct: number | null;
          imbalance_pct: number | null;
          sample_count: number | null;
        };
        Insert: Database['public']['Tables']['window_metrics_1s']['Row'];
        Update: Partial<Database['public']['Tables']['window_metrics_1s']['Row']>;
      };
      fft_results: {
        Row: {
          session_id: string;
          inverter_id: string;
          phase: number;
          window_start: string;
          signal_kind: string;
          fundamental_hz: number | null;
          thd_pct: number | null;
          harmonics_jsonb: Json | null;
          parquet_offset: number | null;
        };
        Insert: Database['public']['Tables']['fft_results']['Row'];
        Update: Partial<Database['public']['Tables']['fft_results']['Row']>;
      };
      waveform_samples: {
        Row: {
          session_id: string;
          inverter_id: string;
          phase: number;
          ts: string;
          voltage: number | null;
          current: number | null;
        };
        Insert: Database['public']['Tables']['waveform_samples']['Row'];
        Update: Partial<Database['public']['Tables']['waveform_samples']['Row']>;
      };
      pmu_samples: {
        Row: {
          session_id: string;
          inverter_id: string;
          phase: number;
          ts: string;
          magnitude: number | null;
          angle_rad: number | null;
          freq_hz: number | null;
          rocof: number | null;
        };
        Insert: Database['public']['Tables']['pmu_samples']['Row'];
        Update: Partial<Database['public']['Tables']['pmu_samples']['Row']>;
      };
      quality_flags: {
        Row: {
          id: number;
          session_id: string;
          ts_start: string | null;
          ts_end: string | null;
          inverter_id: string | null;
          phase: number | null;
          code: string;
          severity: number;
          details: Json | null;
        };
        Insert: Omit<Database['public']['Tables']['quality_flags']['Row'], 'id'> & { id?: number };
        Update: Partial<Database['public']['Tables']['quality_flags']['Insert']>;
      };
      test_events: {
        Row: {
          id: number;
          session_id: string;
          ts: string;
          label: string;
          type: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['test_events']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['test_events']['Insert']>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

// Convenience row types
export type Session = Database['public']['Tables']['sessions']['Row'];
export type IngestJob = Database['public']['Tables']['ingest_jobs']['Row'];
export type SampleDecimated = Database['public']['Tables']['samples_decimated']['Row'];
export type WindowMetric = Database['public']['Tables']['window_metrics_1s']['Row'];
export type FftResult = Database['public']['Tables']['fft_results']['Row'];
export type PmuSample = Database['public']['Tables']['pmu_samples']['Row'];
export type QualityFlag = Database['public']['Tables']['quality_flags']['Row'];
export type TestEvent = Database['public']['Tables']['test_events']['Row'];
export type Inverter = Database['public']['Tables']['inverters']['Row'];
export type WaveformSample = Database['public']['Tables']['waveform_samples']['Row'];
