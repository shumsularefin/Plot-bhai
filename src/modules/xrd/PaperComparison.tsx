import { ANODES } from '../../core/xrd/radiation';
import {
  compareOverall,
  comparePeaks,
  relativeDifference,
  type ComparedPeak,
  type PaperSettings,
} from '../../core/xrd/size/compare';
import type { Pattern } from '../../core/xrd/types';
import { HelpTip } from '../../ui/HelpTip';
import { downloadCsv } from './csv';
import { DEFAULT_PAPER_CHECK, peaksFor, type PaperCheckState, type XrdData } from './data';
import { TableBox } from './MethodDetails';
import { NumberInput } from './NumberInput';

/** A difference above this fraction is called out. */
const LARGE = 0.15;
/** Peaks narrower than this many image pixels have a poorly known width. */
const FEW_PIXELS = 5;

interface PaperComparisonProps {
  data: XrdData;
  update: (patch: Partial<XrdData>) => void;
  pattern: Pattern;
}

const nm = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const deg = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : '–');
const percent = (v: number) =>
  Number.isFinite(v) ? `${v < 0 ? '−' : '+'}${Math.abs(v * 100).toFixed(0)} %` : '–';

/**
 * Results step, for a pattern digitized from a paper's figure: the paper's sizes and settings
 * against sizes recalculated here from the widths read off the figure, with the reasons a
 * difference may have.
 */
export function PaperComparison({ data, update, pattern }: PaperComparisonProps) {
  const fit = peaksFor(data, pattern.id).fit;
  if (!fit) return null;
  const saved = data.paper?.[pattern.id];
  const state: PaperCheckState =
    saved && saved.fitKey === fit.inputKey
      ? saved
      : {
          ...DEFAULT_PAPER_CHECK,
          ...(saved && { ...saved, peaks: {} }),
          lambdaA: saved?.lambdaA ?? ANODES.Cu.kAlpha1,
          fitKey: fit.inputKey,
        };
  const set = (patch: Partial<PaperCheckState>) =>
    update({ paper: { ...data.paper, [pattern.id]: { ...state, ...patch } } });
  const setPeak = (index: number, patch: Partial<PaperCheckState['peaks'][number]>) =>
    set({
      peaks: {
        ...state.peaks,
        [index]: {
          use: false,
          reportedNm: null,
          reportedFwhm: null,
          ...state.peaks[index],
          ...patch,
        },
      },
    });

  const fitted = fit.regions
    .flatMap((r) => r.peaks)
    .sort((a, b) => a.center - b.center)
    .map((p, index) => ({ index, twoTheta: p.center, fwhm: p.fwhm }));
  const settings: PaperSettings = {
    k: state.k,
    lambdaA: state.lambdaA,
    instrumentDeg: state.instrumentDeg,
    correction: state.correction,
  };
  const chosen = fitted.filter((p) => state.peaks[p.index]?.use);
  const compared = comparePeaks(
    chosen.map((p) => ({
      twoTheta: p.twoTheta,
      fwhm: p.fwhm,
      reportedNm: state.peaks[p.index]?.reportedNm ?? null,
      reportedFwhm: state.peaks[p.index]?.reportedFwhm ?? null,
    })),
    settings,
  );
  const byIndex = new Map(chosen.map((p, i) => [p.index, compared[i] as ComparedPeak]));
  const overall =
    compared.length > 0
      ? compareOverall(compared, state.method, settings, state.reportedNm, state.reportedStrain)
      : null;
  const pixelDeg = pattern.digitized?.pixelDeg ?? NaN;
  const lineWidth = pattern.digitized?.lineWidthPx ?? NaN;

  const warnings: string[] = [];
  const narrow = compared.filter((p) => p.fwhm / pixelDeg < FEW_PIXELS);
  if (narrow.length > 0)
    warnings.push(
      `${narrow.map((p) => `${p.twoTheta.toFixed(2)}°`).join(', ')}: the peak is fewer than ${FEW_PIXELS} image pixels wide (${pixelDeg.toFixed(3)}° per pixel), so its width, and the size from it, is only roughly known. The ${lineWidth.toFixed(1)} px thick line also widens narrow peaks a little.`,
    );
  if (state.instrumentDeg === 0)
    warnings.push(
      'No instrument width is subtracted. If the paper corrected for instrument broadening, enter its instrument FWHM, or its sizes will come out larger than those recalculated here.',
    );
  const fwhmMismatch = compared.filter(
    (p) => p.reportedFwhm !== null && Math.abs(relativeDifference(p.fwhm, p.reportedFwhm)) > LARGE,
  );
  if (fwhmMismatch.length > 0)
    warnings.push(
      `${fwhmMismatch.map((p) => `${p.twoTheta.toFixed(2)}°`).join(', ')}: the width measured on the figure differs from the paper's FWHM by more than ${LARGE * 100} %. Check that the paper reports the full width at half maximum in degrees 2θ, and that the right curve was digitized.`,
    );

  const exportCsv = () =>
    downloadCsv(
      `${pattern.name}-paper-comparison`,
      `Paper comparison for ${pattern.name}, digitized from a figure: every recalculated value is approximate. Scherrer D = Kλ/(β cos θ) with K = ${state.k}, λ = ${state.lambdaA} Å, instrument FWHM ${state.instrumentDeg}° (${state.correction} correction).`,
      compared,
      [
        { header: '2theta (deg)', value: (p) => p.twoTheta },
        { header: 'FWHM measured (deg)', value: (p) => p.fwhm },
        { header: 'FWHM paper (deg)', value: (p) => p.reportedFwhm ?? '' },
        { header: 'Sample FWHM used (deg)', value: (p) => p.corrected },
        { header: 'D recalculated (nm)', value: (p) => p.sizeNm },
        { header: 'D paper (nm)', value: (p) => p.reportedNm ?? '' },
        { header: 'Difference (fraction)', value: (p) => p.sizeDifference },
        { header: 'FWHM implied by paper D (deg)', value: (p) => p.impliedFwhm },
      ],
    );

  return (
    <section class="process-step is-on paper-check" aria-labelledby="paper-title">
      <h3 id="paper-title" class="process-step-title">
        Compare with the paper
      </h3>
      <div class="process-step-body">
        <p class="message is-warning">
          <strong>Approximate:</strong> this pattern was read off a figure (
          {pattern.digitized?.image}
          ). Its peak widths, and every size recalculated from them, are estimates limited by the
          image resolution ({pixelDeg.toFixed(3)}° 2θ per pixel) and by how the figure was drawn.
        </p>
        <p class="field-hint">
          Tick the peaks the paper used, type its values, and enter the settings it states. Sizes
          are recalculated with those settings from the widths fitted in the Fit peaks step.
        </p>

        <div class="radiation-fields">
          <label class="inline-field">
            <span>Paper&apos;s method</span>
            <select
              value={state.method}
              onChange={(e) => set({ method: e.currentTarget.value as PaperCheckState['method'] })}
            >
              <option value="scherrer">Scherrer (mean of the ticked peaks)</option>
              <option value="wh-udm">Williamson–Hall (uniform deformation)</option>
            </select>
          </label>
          <NumberInput
            label="K"
            value={state.k}
            min={0}
            max={2}
            onChange={(k) => k !== null && set({ k })}
          />
          <NumberInput
            label="λ (Å)"
            value={state.lambdaA}
            min={0}
            onChange={(lambdaA) => lambdaA !== null && set({ lambdaA })}
            help={
              <HelpTip term="the paper's wavelength">
                <p>
                  The wavelength the paper used, in ångström. Cu Kα1 is 1.5405929 Å; many papers
                  write 1.5406 Å or the Kα average 1.5418 Å.
                </p>
              </HelpTip>
            }
          />
          <NumberInput
            label="Instrument FWHM (°)"
            value={state.instrumentDeg}
            onChange={(v) => set({ instrumentDeg: v !== null && v > 0 ? v : 0 })}
            help={
              <HelpTip term="instrument FWHM">
                <p>
                  The instrument&apos;s own peak width that the paper subtracted, for example from a
                  LaB6 or silicon standard. Leave 0 when the paper subtracted nothing.
                </p>
              </HelpTip>
            }
          />
          {state.instrumentDeg > 0 && (
            <label class="inline-field">
              <span>Correction</span>
              <select
                value={state.correction}
                onChange={(e) =>
                  set({ correction: e.currentTarget.value as PaperCheckState['correction'] })
                }
              >
                <option value="gaussian">Gaussian, β = √(B² − b²)</option>
                <option value="lorentzian">Lorentzian, β = B − b</option>
              </select>
            </label>
          )}
        </div>

        <TableBox label="Peaks compared with the paper" onExport={exportCsv}>
          <thead>
            <tr>
              <th scope="col">Use</th>
              <th scope="col">2θ (°)</th>
              <th scope="col">FWHM here (°)</th>
              <th scope="col">Pixels wide</th>
              <th scope="col">Paper FWHM (°)</th>
              <th scope="col">Paper D (nm)</th>
              <th scope="col">D recalculated (nm)</th>
              <th scope="col">Difference</th>
              <th scope="col">FWHM the paper&apos;s D implies (°)</th>
            </tr>
          </thead>
          <tbody>
            {fitted.map((p) => {
              const c = byIndex.get(p.index);
              const choice = state.peaks[p.index];
              const label = `${p.twoTheta.toFixed(2)}°`;
              return (
                <tr key={p.index}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Compare the peak at ${label}`}
                      checked={choice?.use ?? false}
                      onChange={(e) => setPeak(p.index, { use: e.currentTarget.checked })}
                    />
                  </td>
                  <th scope="row">{p.twoTheta.toFixed(3)}</th>
                  <td>{deg(p.fwhm)}</td>
                  <td>{Number.isFinite(pixelDeg) ? (p.fwhm / pixelDeg).toFixed(1) : '–'}</td>
                  <td>
                    <input
                      type="number"
                      class="table-input"
                      step="any"
                      min="0"
                      inputMode="decimal"
                      aria-label={`Paper FWHM at ${label}, degrees`}
                      disabled={!choice?.use}
                      value={choice?.reportedFwhm ?? ''}
                      onInput={(e) =>
                        setPeak(p.index, { reportedFwhm: positive(e.currentTarget.value) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      class="table-input"
                      step="any"
                      min="0"
                      inputMode="decimal"
                      aria-label={`Paper crystallite size at ${label}, nm`}
                      disabled={!choice?.use}
                      value={choice?.reportedNm ?? ''}
                      onInput={(e) =>
                        setPeak(p.index, { reportedNm: positive(e.currentTarget.value) })
                      }
                    />
                  </td>
                  <td>{c ? nm(c.sizeNm) : ''}</td>
                  <td class={c && Math.abs(c.sizeDifference) > LARGE ? 'is-large' : ''}>
                    {c ? percent(c.sizeDifference) : ''}
                  </td>
                  <td>{c ? deg(c.impliedFwhm) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </TableBox>
        <p class="field-hint">
          Difference = (recalculated − paper) / paper. The last column is the FWHM, in degrees 2θ
          and including any instrument width entered, that would give the paper&apos;s size with its
          own K and λ: compare it with the width measured here.
        </p>

        {compared.flatMap((p) =>
          p.explanations.map((e) => (
            <p key={`${p.twoTheta}-${e.text}`} class="message is-info">
              <strong>Possible explanation at {p.twoTheta.toFixed(2)}°:</strong> {e.text} That slip
              gives {nm(e.sizeNm)} nm, within 5 % of the paper&apos;s {nm(p.reportedNm ?? NaN)} nm.
              This is a guess from the numbers alone; check the paper&apos;s calculation.
            </p>
          )),
        )}

        <div class="radiation-fields">
          <NumberInput
            label={
              state.method === 'scherrer'
                ? "Paper's overall size (nm)"
                : "Paper's Williamson–Hall size (nm)"
            }
            value={state.reportedNm}
            min={0}
            onChange={(reportedNm) => set({ reportedNm })}
          />
          {state.method === 'wh-udm' && (
            <NumberInput
              label="Paper's microstrain ε"
              value={state.reportedStrain}
              onChange={(reportedStrain) => set({ reportedStrain })}
              help={
                <HelpTip term="microstrain">
                  <p>
                    Dimensionless, for example 0.0021. If the paper gives it in percent (0.21 %),
                    divide by 100; if as ×10⁻³, multiply accordingly.
                  </p>
                </HelpTip>
              }
            />
          )}
        </div>

        {overall ? (
          <dl class="summary-grid paper-overall">
            <div>
              <dt>
                {state.method === 'scherrer'
                  ? `Mean Scherrer size, ${compared.length} peak${compared.length === 1 ? '' : 's'}`
                  : `Williamson–Hall size, ${compared.length} peaks`}
              </dt>
              <dd>
                {nm(overall.sizeNm)} nm (estimate)
                {state.reportedNm !== null && (
                  <>
                    {' '}
                    against {nm(state.reportedNm)} nm: {percent(overall.sizeDifference)}
                  </>
                )}
              </dd>
            </div>
            {state.method === 'wh-udm' && (
              <div>
                <dt>Williamson–Hall microstrain</dt>
                <dd>
                  {Number.isFinite(overall.strain) ? overall.strain.toExponential(2) : '–'}
                  {state.reportedStrain !== null && (
                    <>
                      {' '}
                      against {state.reportedStrain.toExponential(2)}:{' '}
                      {percent(overall.strainDifference)}
                    </>
                  )}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p class="field-hint">Tick at least one peak to compare.</p>
        )}
        {overall?.messages.map((m) => (
          <p key={m} class="message is-warning">
            <strong>Check:</strong> {m}
          </p>
        ))}
        {overall && Math.abs(overall.sizeDifference) > LARGE && (
          <p class="message is-warning">
            <strong>Large difference:</strong> the recalculated size differs from the paper&apos;s
            by {percent(overall.sizeDifference)}. Usual reasons: a different K or λ, an instrument
            correction the paper applied, integral breadth used instead of FWHM, other peaks, or a
            figure too coarse to measure the widths.
          </p>
        )}
        {warnings.map((w) => (
          <p key={w} class="message is-warning">
            <strong>Check:</strong> {w}
          </p>
        ))}

        <details class="method-details">
          <summary>Calculation details</summary>
          <p>
            Scherrer: D = Kλ / (β cos θ), with β the sample FWHM in radians and θ half of 2θ. Here K
            = {state.k} and λ = {state.lambdaA} Å = {(state.lambdaA / 10).toFixed(5)} nm.
          </p>
          <p>
            {state.instrumentDeg > 0
              ? state.correction === 'gaussian'
                ? `The instrument width b = ${state.instrumentDeg}° is removed as β = √(B² − b²).`
                : `The instrument width b = ${state.instrumentDeg}° is removed as β = B − b.`
              : 'No instrument width is removed: β is the FWHM fitted to the digitized curve.'}
          </p>
          {state.method === 'wh-udm' && (
            <p>
              Williamson–Hall (uniform deformation): β cos θ = Kλ / D + 4ε sin θ, a straight line
              through the ticked peaks; D from the intercept and ε from the slope.
            </p>
          )}
          <p>
            The widths come from the peak fit (Fit peaks step) on the digitized curve (one point per
            image pixel, {pixelDeg.toFixed(3)}° apart). Positions are as accurate as the axis
            calibration; widths of peaks only a few pixels wide are the least reliable.
          </p>
        </details>
      </div>
    </section>
  );
}

/** A typed number above zero, or null. */
function positive(text: string): number | null {
  const v = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(v) && v > 0 ? v : null;
}
