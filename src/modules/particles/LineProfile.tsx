import { useMemo, useState } from 'preact/hooks';
import { lineProfile } from '../../core/particles/detect/measure';
import {
  NM_PER_UNIT,
  UNIT_LABELS,
  type LengthUnit,
  type Measurement,
} from '../../core/particles/geometry';
import { HelpTip } from '../../ui/HelpTip';
import { DEFAULT_EXPORT_SETTINGS } from '../../ui/plot/export';
import { PlotPanel, type PlotSettings } from '../../ui/plot/PlotPanel';

interface LineProfileProps {
  /** Hand-drawn lines, in original pixels. */
  lines: readonly Measurement[];
  /** The working copy as grayscale, unadjusted. */
  gray: () => { gray: Uint8Array; width: number; height: number };
  /** Working copy size divided by original size. */
  workScale: number;
  perPixelNm: number | null;
  unit: 'px' | LengthUnit;
  name: string;
}

/**
 * ImageJ's Plot Profile: the grey levels of the original image along a line drawn with
 * "Add a line". Useful to see how sharp a particle edge is, or where the threshold sits on it.
 */
export function LineProfile({ lines, gray, workScale, perPixelNm, unit, name }: LineProfileProps) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [plot, setPlot] = useState<PlotSettings>({
    normalise: false,
    offsetPercent: 0,
    export: DEFAULT_EXPORT_SETTINGS,
  });
  const line = lines.find((m) => m.id === chosen) ?? lines[lines.length - 1];
  const calibrated = unit !== 'px' && perPixelNm !== null;
  const unitLabel = calibrated ? UNIT_LABELS[unit] : 'px';
  const sources = useMemo(() => {
    if (!line) return [];
    const g = gray();
    const at = (p: Measurement['a']) => ({ x: p.x * workScale, y: p.y * workScale });
    const profile = lineProfile(g.gray, g.width, g.height, at(line.a), at(line.b));
    // Distances back to original pixels, then to the chosen unit.
    const factor = calibrated ? (perPixelNm as number) / NM_PER_UNIT[unit as LengthUnit] : 1;
    const x = profile.distance.map((d) => (d / workScale) * factor);
    return [
      { id: `line-${line.id}`, name: `Line ${line.id}`, x, y: profile.value, unit: unitLabel },
    ];
  }, [line, workScale, calibrated, perPixelNm, unit]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!line) {
    return <p class="field-hint">Draw a line with "Add a line" to see the grey levels along it.</p>;
  }
  return (
    <div class="line-profile">
      <div class="radiation-fields">
        <label class="inline-field">
          Line
          <select value={line.id} onChange={(e) => setChosen(Number(e.currentTarget.value))}>
            {lines.map((m) => (
              <option key={m.id} value={m.id}>
                Line {m.id}
              </option>
            ))}
          </select>
        </label>
        <HelpTip term="plot profile">
          <p>
            The grey level (0 black to 255 white) of the original image along the line, from its
            start to its end, sampled one pixel apart with bilinear interpolation. A sharp particle
            edge is a steep step; a blurred edge is a slow ramp, and then the size depends on the
            threshold.
            {workScale < 1 &&
              ` Large images are read on the working copy (${Math.round(workScale * 100)} % of the original size).`}
          </p>
        </HelpTip>
      </div>
      <PlotPanel
        sources={sources}
        settings={plot}
        onSettingsChange={(patch) => setPlot((current) => ({ ...current, ...patch }))}
        labels={() => ({
          x: `Distance along the line (${unitLabel})`,
          y: 'Grey level',
          yValues: true,
        })}
        xName="Distance"
        xUnit={unitLabel}
        exportName={`${name}-profile-line-${line.id}`}
        showOverlayOptions={false}
        dock="manual"
      />
    </div>
  );
}
