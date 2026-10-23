import { useMemo } from 'preact/hooks';
import type { Pattern } from '../../core/xrd/types';
import { PlotPanel, type PlotSettings } from '../../ui/plot/PlotPanel';
import { xrdLabels } from './labels';

interface XrdPlotProps {
  patterns: readonly Pattern[];
  settings: PlotSettings;
  onSettingsChange: (patch: Partial<PlotSettings>) => void;
}

const UNIT_LABELS = { counts: 'counts', cps: 'cps' } as const;

/** The shared plot panel set up for diffraction patterns. */
export function XrdPlot({ patterns, settings, onSettingsChange }: XrdPlotProps) {
  const sources = useMemo(
    () =>
      patterns.map((p) => ({
        id: p.id,
        name: p.name,
        x: p.twoTheta,
        y: p.intensity,
        unit: UNIT_LABELS[p.intensityUnit],
      })),
    [patterns],
  );
  const exportName = patterns.length === 1 ? (patterns[0] as Pattern).name : 'xrd-patterns';
  return (
    <PlotPanel
      sources={sources}
      settings={settings}
      onSettingsChange={onSettingsChange}
      labels={xrdLabels}
      xName="2θ"
      xUnit="°"
      exportName={exportName}
    />
  );
}
