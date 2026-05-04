import { create } from 'zustand';

interface SessionStore {
  // Synchronized zoom range across all charts: [minUnixSec, maxUnixSec] | null = no zoom
  zoomRange: [number, number] | null;
  setZoomRange: (range: [number, number] | null) => void;

  // Per-chart collapsed state — chartId → collapsed
  collapsed: Record<string, boolean>;
  toggleCollapsed: (chartId: string) => void;

  // Per-chart phase visibility — chartId → Set of hidden phases (0=A,1=B,2=C)
  hiddenPhases: Record<string, Set<number>>;
  togglePhase: (chartId: string, phase: number) => void;
  isPhaseHidden: (chartId: string, phase: number) => boolean;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  zoomRange: null,
  setZoomRange: (range) => set({ zoomRange: range }),

  collapsed: {},
  toggleCollapsed: (chartId) =>
    set((s) => ({
      collapsed: { ...s.collapsed, [chartId]: !s.collapsed[chartId] },
    })),

  hiddenPhases: {},
  togglePhase: (chartId, phase) =>
    set((s) => {
      const current = new Set(s.hiddenPhases[chartId] ?? []);
      if (current.has(phase)) current.delete(phase);
      else current.add(phase);
      return { hiddenPhases: { ...s.hiddenPhases, [chartId]: current } };
    }),
  isPhaseHidden: (chartId, phase) => get().hiddenPhases[chartId]?.has(phase) ?? false,
}));
