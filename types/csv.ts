// CSV format definitions for FDR card exports

export interface FdrRow {
  timestamp: string | number;
  // Inverter 1
  inv1_phA_voltage?: string;
  inv1_phA_current?: string;
  inv1_phB_voltage?: string;
  inv1_phB_current?: string;
  inv1_phC_voltage?: string;
  inv1_phC_current?: string;
  // Inverter 2
  inv2_phA_voltage?: string;
  inv2_phA_current?: string;
  inv2_phB_voltage?: string;
  inv2_phB_current?: string;
  inv2_phC_voltage?: string;
  inv2_phC_current?: string;
  // Inverter 3
  inv3_phA_voltage?: string;
  inv3_phA_current?: string;
  inv3_phB_voltage?: string;
  inv3_phB_current?: string;
  inv3_phC_voltage?: string;
  inv3_phC_current?: string;
  // PMU
  pmu_voltage_mag?: string;
  pmu_voltage_angle?: string;
  pmu_frequency?: string;
  pmu_rocof?: string;
  // Optional
  load_bank_power_kw?: string;
  frequency?: string;
  [key: string]: string | number | undefined;
}

export interface ColumnMapping {
  timestamp: string;
  fileFormat: 'waveform' | 'phasor';
  inverters: {
    inverterId: number; // 1, 2, or 3
    phaseA_voltage: string;
    phaseA_current: string;
    phaseB_voltage?: string;
    phaseB_current?: string;
    phaseC_voltage?: string;
    phaseC_current?: string;
    // Phasor-only: angle columns (degrees)
    phaseA_voltage_angle?: string;
    phaseA_current_angle?: string;
    phaseB_voltage_angle?: string;
    phaseB_current_angle?: string;
    phaseC_voltage_angle?: string;
    phaseC_current_angle?: string;
  }[];
  pmu?: {
    voltage_mag: string;
    voltage_angle: string;
    frequency: string;
    rocof?: string;
  };
}

export interface CsvPreview {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  detectedSampleRateHz: number;
  detectedInverterCount: number;
  detectedPhaseCount: number;
  hasPmu: boolean;
  suggestedMapping: ColumnMapping;
}

export interface ParsedSample {
  ts: number; // unix ms
  inverterId: number; // 1-based
  phase: 0 | 1 | 2; // 0=A, 1=B, 2=C
  voltageRms: number;
  currentRms: number;
  freqHz?: number;
}

export interface ParsedPmuSample {
  ts: number;
  inverterId: number;
  phase: 0 | 1 | 2;
  magnitude: number;
  angleRad: number;
  freqHz: number;
  rocof?: number;
}
