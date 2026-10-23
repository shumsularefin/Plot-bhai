import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  DEFAULT_MATCH,
  matchPhase,
  referenceLines,
  type MatchResult,
} from '../../core/xrd/reference/match';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import { ANODES } from '../../core/xrd/radiation';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { ReferenceLane } from '../../ui/plot/ReferenceLanes';
import type { SeriesSource } from '../../ui/plot/series';
import type { StepContext } from '../../ui/wizard/types';
import type { MaterialState, XrdData } from './data';
import { xrdLabels } from './labels';
import { codUrl, formatHkl, loadReferenceFamily, loadReferenceIndex } from './referenceLibrary';
import { useMeasured } from './useMeasured';

/** Palette indices for the phases; the measured pattern uses 7 (the dark colour). */
const PHASE_COLORS = [0, 1, 2, 3, 4, 5, 6];

/** Wizard step 4: draw the candidate phases under the pattern and score each one. */
export function PhasesStep({ data, update }: StepContext<XrdData>) {
  const material = data.material;
  const [patternId, setPatternId] = useState(data.patterns[0]?.id);
  const { pattern, processed, detected } = useMeasured(data, patternId);
  const [phases, setPhases] = useState<ReferencePhase[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!material.familyId) {
      setPhases(null);
      return;
    }
    let current = true;
    loadReferenceIndex()
      .then((index) => {
        const family = index.families.find((f) => f.id === material.familyId);
        return family ? loadReferenceFamily(family.file) : [];
      })
      .then(
        (loaded) => current && setPhases(loaded),
        () => current && setFailed(true),
      );
    return () => {
      current = false;
    };
  }, [material.familyId]);

  const lambda = ANODES[data.radiation.anode].kAlpha1;
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
    return phases.map((phase) => {
      const lines = referenceLines(phase, lambda);
      return { phase, lines, match: matchPhase(lines, peaks, range, options) };
    });
  }, [phases, processed, detected, lambda, options]);

  const sources = useMemo<SeriesSource[]>(
    () =>
      processed && pattern
        ? [
            {
              id: 'data',
              name: pattern.name,
              x: processed.twoTheta,
              y: processed.intensity,
              unit: pattern.intensityUnit === 'counts' ? 'counts' : 'cps',
              colorIndex: 7,
            },
          ]
        : [],
    [processed, pattern],
  );
  const markers = useMemo(
    () => (detected ?? []).map((p) => ({ x: p.center, y: p.height })),
    [detected],
  );
  const lanes = useMemo<ReferenceLane[]>(
    () =>
      (analysis ?? [])
        .map((a, i) => ({ ...a, color: PHASE_COLORS[i % PHASE_COLORS.length] as number }))
        .filter((a) => !material.hidden.includes(a.phase.id))
        .map((a) => {
          const found = new Map(a.match.lines.map((l) => [l.d, l.observed !== null]));
          return {
            id: a.phase.id,
            name: `${a.phase.name}, COD ${a.phase.codId}`,
            colorIndex: a.color,
            lines: a.lines
              .filter((l) => l.intensity >= 1)
              .map((l) => ({
                x: l.twoTheta + a.match.shift,
                height: l.intensity / 100,
                ...(found.has(l.d) && { found: found.get(l.d) as boolean }),
              })),
          };
        }),
    [analysis, material.hidden],
  );

  const setMaterial = (patch: Partial<MaterialState>) =>
    update({ material: { ...material, ...patch } });

  if (data.patterns.length === 0)
    return <p>No patterns are loaded. Go back to Upload to add one.</p>;
  if (!material.familyId)
    return (
      <p class="message is-info">
        <strong>Note:</strong> no material is chosen, so there is nothing to compare. Go back one
        step to choose one, or continue without reference phases.
      </p>
    );
  if (failed)
    return (
      <p class="message is-error">
        <strong>Problem:</strong> the reference lines could not be loaded. Reload the page, or
        continue without reference phases.
      </p>
    );

  return (
    <div class="phases-step">
      <p class="message is-info">
        <strong>Note:</strong> the score is a guide only. It works for simple, well-separated phases
        and is not reliable for mixtures. Reference lines are calculated from COD structures for{' '}
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
          ? `${detected.length} peak${detected.length === 1 ? '' : 's'} found in your cleaned pattern (circles). The number depends on the prominence setting of step 5.`
          : 'Finding peaks…'}{' '}
        Each phase is shifted by one zero-shift value (at most ±0.3°) that gives its best score.
      </p>

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
        />
      ) : (
        <p aria-busy="true">Preparing the pattern…</p>
      )}

      <ul class="phase-cards" aria-label="Candidate phases">
        {(analysis ?? []).map(({ phase, match }, i) => (
          <PhaseCard
            key={phase.id}
            phase={phase}
            match={match}
            colorIndex={PHASE_COLORS[i % PHASE_COLORS.length] as number}
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
  return (
    <li class="phase-card">
      <div class="phase-card-header">
        <span class={`plot-swatch series-${colorIndex % 8}`} aria-hidden="true" />
        <h3 class="phase-card-title">{phase.name}</h3>
        <a href={codUrl(phase.codId)} target="_blank" rel="noopener noreferrer">
          COD {phase.codId}
        </a>
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
