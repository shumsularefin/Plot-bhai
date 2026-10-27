import { phaseReference } from '../../core/xrd/reference/source';
import { useMemo, useState } from 'preact/hooks';
import {
  DEFAULT_MATCH,
  matchPhase,
  referenceLines,
  unexplainedPeaks,
  type MatchResult,
} from '../../core/xrd/reference/match';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import { ANODES } from '../../core/xrd/radiation';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { ReferenceLane } from '../../ui/plot/ReferenceLanes';
import type { SeriesSource } from '../../ui/plot/series';
import type { StepContext } from '../../ui/wizard/types';
import {
  peaksFor,
  processingFor,
  type MaterialState,
  type SimulationState,
  type XrdData,
} from './data';
import { xrdLabels } from './labels';
import { formatHkl } from '../../core/xrd/reference/hkl';
import { codUrl } from './referenceLibrary';
import { useCandidatePhases } from './useReferencePhases';
import { NumberInput } from './NumberInput';
import { Advanced } from '../../ui/Advanced';
import { fitScales, simulateProfile } from '../../core/xrd/reference/simulate';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { useMeasured } from './useMeasured';

/** Palette indices for the phases; the measured pattern uses 7 (the dark colour). */
const PHASE_COLORS = [0, 1, 2, 3, 4, 5, 6];

/** Short lane label: the phase name and its COD entry (or file name when it has none). */
function laneName(phase: ReferencePhase): string {
  const origin = phase.origin;
  const source =
    origin?.kind === 'cif' ? (origin.database ?? origin.fileName) : phaseReference(phase);
  return `${phase.name} · ${source}`;
}

/**
 * The few strongest lines of a phase that get an (hkl) tag in its lane: at most 5, strongest
 * first, skipping any within 1.5° of a line already tagged so the tags do not overlap.
 */
function tagged<T extends { twoTheta: number; intensity: number }>(lines: readonly T[]): Set<T> {
  const chosen: T[] = [];
  for (const line of [...lines].sort((a, b) => b.intensity - a.intensity)) {
    if (chosen.length >= 5 || line.intensity < 10) break;
    if (chosen.every((c) => Math.abs(c.twoTheta - line.twoTheta) > 1.5)) chosen.push(line);
  }
  return new Set(chosen);
}

/** Median fitted FWHM of a pattern (degrees), the starting width of the calculated lines. */
function medianFwhm(data: XrdData, patternId: string | undefined): number | null {
  if (!patternId) return null;
  const widths = (peaksFor(data, patternId).fit?.regions ?? [])
    .flatMap((r) => r.peaks.map((p) => p.fwhm))
    .filter((w) => Number.isFinite(w) && w > 0)
    .sort((a, b) => a - b);
  return widths.length > 0 ? (widths[widths.length >> 1] as number) : null;
}

/** Wizard step 4: draw the candidate phases under the pattern and score each one. */
export function PhasesStep({ data, update }: StepContext<XrdData>) {
  const material = data.material;
  const simulation = material.simulation;
  const [patternId, setPatternId] = useState(data.patterns[0]?.id);
  /** Phase drawn as guide lines through the plot, or null to compare all shown phases. */
  // undefined until the user picks: then a single shown phase is focused, several are not.
  const [focusId, setFocusId] = useState<string | null | undefined>(undefined);
  const { pattern, processed, detected } = useMeasured(data, patternId);
  const { phases, failed } = useCandidatePhases(material);

  const lines = ANODES[data.radiation.anode];
  const lambda = lines.kAlpha1;
  const options = useMemo(
    () => ({ ...DEFAULT_MATCH, toleranceDeg: material.toleranceDeg }),
    [material.toleranceDeg],
  );
  const analysis = useMemo(() => {
    if (!phases || !processed || !detected) return null;
    const range = [
      processed.twoTheta[0] as number,
      processed.twoTheta[processed.twoTheta.length - 1] as number,
    ] as const;
    const peaks = detected.map((p) => p.center);
    return phases.map((phase, i) => {
      const phaseLines = referenceLines(phase, lambda);
      return {
        phase,
        lines: phaseLines,
        match: matchPhase(phaseLines, peaks, range, options),
        color: PHASE_COLORS[i % PHASE_COLORS.length] as number,
      };
    });
  }, [phases, processed, detected, lambda, options]);

  const processing = pattern ? processingFor(data, pattern.id) : null;
  const kAlpha2InData = !data.radiation.kAlpha1Only && !processing?.kAlpha2.enabled;
  const backgroundRemoved = processing?.background.enabled ?? false;
  const visible = useMemo(
    () => (analysis ?? []).filter((a) => !material.hidden.includes(a.phase.id)),
    [analysis, material.hidden],
  );
  const focus =
    focusId === undefined && visible.length === 1
      ? (visible[0] ?? null)
      : (visible.find((a) => a.phase.id === focusId) ?? null);
  const unexplained = useMemo(
    () =>
      detected && visible.length > 0
        ? unexplainedPeaks(
            detected.map((p) => p.center),
            visible.map((a) =>
              a.lines.filter((l) => l.intensity >= 1).map((l) => l.twoTheta + a.match.shift),
            ),
            material.toleranceDeg,
          )
        : [],
    [detected, visible, material.toleranceDeg],
  );

  /** Calculated profiles of the shown phases, scaled together to the data by least squares. */
  const calculated = useMemo(() => {
    if (!simulation.show || !processed || visible.length === 0) return null;
    const x = processed.twoTheta;
    const profiles = visible.map((a) =>
      simulateProfile(a.lines, x, {
        fwhmDeg: simulation.fwhmDeg,
        eta: simulation.eta,
        shiftDeg: a.match.shift,
        kAlpha2: kAlpha2InData
          ? { lambda1: lines.kAlpha1, lambda2: lines.kAlpha2, ratio: data.radiation.kAlpha2Ratio }
          : null,
      }),
    );
    const scales = fitScales(processed.intensity, profiles);
    const total = new Float64Array(x.length);
    profiles.forEach((p, k) =>
      p.forEach((v, i) => (total[i] = (total[i] as number) + v * (scales[k] as number))),
    );
    const residual = processed.intensity.map((v, i) => v - (total[i] as number));
    return { profiles, scales, total, residual };
  }, [simulation, processed, visible, kAlpha2InData, lines, data.radiation.kAlpha2Ratio]);

  const unit = pattern?.intensityUnit === 'counts' ? 'counts' : 'cps';
  const sources = useMemo<SeriesSource[]>(() => {
    if (!processed || !pattern) return [];
    const list: SeriesSource[] = [
      {
        id: 'data',
        name: pattern.name,
        x: processed.twoTheta,
        y: processed.intensity,
        unit,
        colorIndex: 7,
      },
    ];
    if (calculated) {
      visible.forEach((a, k) => {
        const scale = calculated.scales[k] as number;
        if (scale > 0 && (!focus || focus === a))
          list.push({
            id: `calc-${a.phase.id}`,
            name: `${a.phase.name} (calculated)`,
            x: processed.twoTheta,
            y: (calculated.profiles[k] as Float64Array).map((v) => v * scale),
            unit,
            colorIndex: a.color,
            dashed: true,
          });
      });
    }
    return list;
  }, [processed, pattern, unit, calculated, visible, focus]);
  const residual = useMemo<SeriesSource | undefined>(
    () =>
      calculated && processed
        ? {
            id: 'difference',
            name: 'Measured − calculated',
            x: processed.twoTheta,
            y: calculated.residual,
            unit,
            colorIndex: 7,
          }
        : undefined,
    [calculated, processed, unit],
  );
  const markers = useMemo(
    () => (detected ?? []).map((p) => ({ x: p.center, y: p.height })),
    [detected],
  );
  const lanes = useMemo<ReferenceLane[]>(
    () =>
      visible.map((a) => {
        const found = new Map(a.match.lines.map((l) => [l.d, l.observed !== null]));
        const tags = tagged(a.lines);
        return {
          id: a.phase.id,
          name: laneName(a.phase),
          note: `score ${Math.round(a.match.score * 100)} %`,
          colorIndex: a.color,
          focused: a === focus,
          lines: a.lines
            .filter((l) => l.intensity >= 1)
            .map((l) => {
              const x = l.twoTheta + a.match.shift;
              const isFound = found.get(l.d);
              return {
                x,
                // Square-root scale on screen, so weak lines stay visible (said in the lanes' key).
                height: Math.sqrt(l.intensity / 100),
                ...(tags.has(l) && { tag: formatHkl(l.hkl.slice(0, 1)) }),
                label: `${a.phase.name} ${formatHkl(l.hkl)}, 2θ ${x.toFixed(2)}°, I ${l.intensity.toFixed(0)} %${isFound === false ? ', no measured peak' : ''}`,
                ...(isFound !== undefined && { found: isFound }),
              };
            }),
        };
      }),
    [visible, focus],
  );

  const setMaterial = (patch: Partial<MaterialState>) =>
    update({ material: { ...material, ...patch } });
  const setSimulation = (patch: Partial<SimulationState>) =>
    setMaterial({ simulation: { ...simulation, ...patch } });

  if (data.patterns.length === 0)
    return <p>No patterns are loaded. Go back to Upload to add one.</p>;
  if (material.candidates.length === 0)
    return (
      <p class="message is-info">
        <strong>Note:</strong> no candidate phase is chosen, so there is nothing to compare. Go back
        one step to search COD or load a CIF file, or continue without reference phases.
      </p>
    );
  if (failed)
    return (
      <p class="message is-error">
        <strong>Problem:</strong> the reference lines could not be loaded. Reload the page, or
        continue without reference phases.
      </p>
    );
  const fittedWidth = medianFwhm(data, pattern?.id);

  return (
    <div class="phases-step">
      <p class="message is-info">
        <strong>Note:</strong> the score is a guide only. It works for simple, well-separated phases
        and is not reliable for mixtures. Reference lines are calculated from each structure for{' '}
        {data.radiation.anode} Kα1 (λ = {lambda} Å).
      </p>
      <div class="clean-toolbar">
        {data.patterns.length > 1 && (
          <label class="inline-field">
            Pattern
            <select value={pattern?.id} onChange={(e) => setPatternId(e.currentTarget.value)}>
              {data.patterns.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label class="inline-field">
          <span>
            Tolerance (° 2θ){' '}
            <HelpTip term="tolerance">
              <p>
                A reference line counts as found when a peak of your pattern lies within this many
                degrees 2θ of it. Use a larger value for broad peaks or an instrument with a
                sample-height error.
              </p>
            </HelpTip>
          </span>
          <input
            type="number"
            aria-label="Tolerance (° 2θ)"
            inputMode="decimal"
            min={0.02}
            max={1}
            step={0.01}
            value={material.toleranceDeg}
            onChange={(e) => {
              const v = Number(e.currentTarget.value);
              if (Number.isFinite(v) && v >= 0.02 && v <= 1) setMaterial({ toleranceDeg: v });
            }}
          />
        </label>
      </div>
      <p class="field-hint">
        {detected
          ? `${detected.length} peak${detected.length === 1 ? '' : 's'} found in your cleaned pattern (circles). The number depends on the settings of step 5.`
          : 'Finding peaks…'}{' '}
        Each phase is shifted by one zero-shift value (at most ±0.3°) that gives its best score.
      </p>

      <section class="process-step is-on" aria-labelledby="calc-title">
        <h3 id="calc-title" class="process-step-title">
          Calculated patterns{' '}
          <HelpTip term="calculated pattern">
            <p>
              Each shown phase is drawn as a full profile: every reference line gets the same
              pseudo-Voigt shape and width (and a Kα2 copy when your data still contain Kα2), and
              the phases are scaled together to your pattern by least squares. The lower panel shows
              measured minus calculated. This is a visual check of positions and relative
              intensities: widths, shapes, cell and preferred orientation are not refined, and the
              scales are not phase fractions. The optional Rietveld step that follows refines them.
            </p>
          </HelpTip>
        </h3>
        <label class="check">
          <input
            type="checkbox"
            checked={simulation.show}
            onChange={(e) => setSimulation({ show: e.currentTarget.checked })}
          />
          Overlay the calculated patterns of the shown phases
        </label>
        {simulation.show && (
          <>
            <div class="radiation-fields">
              <NumberInput
                label="Line width, FWHM (° 2θ)"
                value={simulation.fwhmDeg}
                min={0.005}
                max={5}
                step={0.01}
                onChange={(v) => v !== null && setSimulation({ fwhmDeg: v })}
              />
              {fittedWidth !== null && Math.abs(fittedWidth - simulation.fwhmDeg) > 1e-4 && (
                <button
                  type="button"
                  class="btn"
                  onClick={() => setSimulation({ fwhmDeg: Number(fittedWidth.toFixed(3)) })}
                >
                  Use the median fitted width ({fittedWidth.toFixed(3)}°)
                </button>
              )}
            </div>
            <Advanced id="xrd-simulation-shape" title="Line shape">
              <NumberInput
                label="Lorentzian fraction η (0 Gaussian, 1 Lorentzian)"
                value={simulation.eta}
                max={1}
                step={0.05}
                onChange={(v) => v !== null && v >= 0 && setSimulation({ eta: v })}
              />
            </Advanced>
            {!backgroundRemoved && (
              <p class="message is-warning">
                <strong>Check:</strong> the background is still in the data, so the calculated
                patterns are scaled against peaks plus background. Remove the background in step 2
                for a fair comparison.
              </p>
            )}
            {calculated && (
              <p class="field-hint">
                Scales (counts per unit of relative intensity, not phase fractions):{' '}
                {visible
                  .map(
                    (a, k) => `${a.phase.name} ${formatNumber(calculated.scales[k] as number, 3)}`,
                  )
                  .join('; ')}
                {calculated.scales.some((v) => v === 0) &&
                  '. A scale of 0 means that phase does not help describe the pattern.'}
              </p>
            )}
          </>
        )}
      </section>

      {processed && pattern ? (
        <PlotPanel
          sources={sources}
          settings={data.plot}
          onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
          labels={xrdLabels}
          xName="2θ"
          xUnit="°"
          exportName={`${pattern.name}-phases`}
          showOverlayOptions={false}
          interaction={{ markers }}
          lanes={lanes}
          lanesKey="Line height is the square root of the reference intensity, so weak lines stay visible. Point at a line to see its (hkl) and 2θ."
          {...(visible.length > 0 && {
            toolbar: (
              <fieldset class="segmented">
                <legend>
                  Compare{' '}
                  <HelpTip term="compare">
                    <p>
                      Pick one phase to draw its reference lines as dashed guides through your
                      pattern and to show only its calculated profile. Solid sticks in the lanes
                      have a measured peak within the tolerance; dashed, faint sticks have none.
                      Hover or tap a stick to see its (hkl) and position.
                    </p>
                  </HelpTip>
                </legend>
                {[null, ...visible].map((a) => {
                  const id = a?.phase.id ?? null;
                  return (
                    <label
                      key={id ?? 'all'}
                      class={(focus ? focus === a : id === null) ? 'is-selected' : undefined}
                    >
                      <input
                        type="radio"
                        name="phase-focus"
                        checked={focus ? focus === a : id === null}
                        onChange={() => setFocusId(id)}
                      />
                      {a ? (
                        <>
                          <span class={`plot-swatch series-${a.color % 8}`} aria-hidden="true" />
                          {a.phase.name}
                        </>
                      ) : (
                        'All shown phases'
                      )}
                    </label>
                  );
                })}
              </fieldset>
            ),
          })}
          {...(residual && {
            residual,
            lowerAxis: { y: 'Meas. − calc.', description: 'Measured minus calculated pattern.' },
          })}
        />
      ) : (
        <p aria-busy="true">Preparing the pattern…</p>
      )}

      {detected && visible.length > 0 && (
        <p class="field-hint">
          {unexplained.length === 0
            ? 'Every peak found in your pattern lies near a line of a shown phase.'
            : `Peaks no shown phase explains (${unexplained.length}): ${unexplained.map((x) => `${x.toFixed(2)}°`).join(', ')}. They may belong to another phase, Kα2, or be noise.`}
        </p>
      )}
      {!phases && <p aria-busy="true">Loading the reference lines…</p>}
      <ul class="phase-cards" aria-label="Candidate phases">
        {(analysis ?? []).map(({ phase, match, color }) => (
          <PhaseCard
            key={phase.id}
            phase={phase}
            match={match}
            colorIndex={color}
            shown={!material.hidden.includes(phase.id)}
            used={material.phaseIds.includes(phase.id)}
            onShown={(on) =>
              setMaterial({
                hidden: on
                  ? material.hidden.filter((h) => h !== phase.id)
                  : [...material.hidden, phase.id],
              })
            }
            onUsed={(on) =>
              setMaterial({
                phaseIds: on
                  ? [...material.phaseIds.filter((p) => p !== phase.id), phase.id]
                  : material.phaseIds.filter((p) => p !== phase.id),
              })
            }
          />
        ))}
      </ul>
    </div>
  );
}

interface PhaseCardProps {
  phase: ReferencePhase;
  match: MatchResult;
  colorIndex: number;
  shown: boolean;
  used: boolean;
  onShown: (on: boolean) => void;
  onUsed: (on: boolean) => void;
}

function PhaseCard({ phase, match, colorIndex, shown, used, onShown, onUsed }: PhaseCardProps) {
  const percent = Math.round(match.score * 100);
  const found = match.lines.filter((l) => l.observed !== null).length;
  const missing = match.lines
    .filter((l) => l.observed === null)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 3);
  return (
    <li class="phase-card">
      <div class="phase-card-header">
        <span class={`plot-swatch series-${colorIndex % 8}`} aria-hidden="true" />
        <h3 class="phase-card-title">{phase.name}</h3>
        {phase.codId !== null ? (
          <a href={codUrl(phase.codId)} target="_blank" rel="noopener noreferrer">
            {phaseReference(phase)}
          </a>
        ) : (
          <span>{phaseReference(phase)}</span>
        )}
        <span class="phase-card-system">
          {phase.crystalSystem}, {phase.spaceGroup.hm}
        </span>
      </div>
      <div class="score-row">
        <div class="score-bar" aria-hidden="true">
          <div class="score-fill" style={{ width: `${percent}%` }} />
        </div>
        <p class="score-text">
          <strong>Score {percent} %</strong> (guide only): {found} of {match.lines.length} lines
          stronger than 5 % found, zero shift {match.shift >= 0 ? '+' : '−'}
          {Math.abs(match.shift).toFixed(2)}°.
          {missing.length > 0 &&
            ` Strongest lines with no peak: ${missing.map((l) => `${formatHkl(l.hkl)} at ${l.twoTheta.toFixed(2)}° (${l.intensity.toFixed(0)} %)`).join(', ')}.`}
        </p>
      </div>
      <div class="phase-card-actions">
        <label class="check">
          <input
            type="checkbox"
            checked={shown}
            onChange={(e) => onShown(e.currentTarget.checked)}
          />
          Show lines
        </label>
        <label class="check">
          <input type="checkbox" checked={used} onChange={(e) => onUsed(e.currentTarget.checked)} />
          Use this phase
        </label>
      </div>
      <details>
        <summary>Matched and unmatched lines</summary>
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label={`Lines of ${phase.name}, scrolls sideways`}
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">(hkl)</th>
                <th scope="col">Reference 2θ (°, shifted)</th>
                <th scope="col">d (Å)</th>
                <th scope="col">I (%)</th>
                <th scope="col">Measured 2θ (°)</th>
                <th scope="col">Found</th>
              </tr>
            </thead>
            <tbody>
              {match.lines.map((l, i) => (
                <tr key={i}>
                  <td>{formatHkl(l.hkl)}</td>
                  <td>{l.twoTheta.toFixed(3)}</td>
                  <td>{l.d.toFixed(4)}</td>
                  <td>{l.intensity.toFixed(1)}</td>
                  <td>{l.observed === null ? '–' : l.observed.toFixed(3)}</td>
                  <td>{l.observed === null ? 'no peak' : 'yes'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </li>
  );
}
