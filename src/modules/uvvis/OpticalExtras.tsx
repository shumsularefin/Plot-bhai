import { useMemo } from 'preact/hooks';
import { HC_EV_NM } from '../../core/uvvis/conversions';
import { SIGMOID_LABELS, SIGMOID_N, type SigmoidType } from '../../core/uvvis/crossChecks';
import {
  extinctionCoefficient,
  INDEX_RELATIONS,
  indexFromGap,
  inIndexRange,
  type IndexRelation,
} from '../../core/uvvis/optics';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { PlotMarker } from '../../ui/plot/types';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { TableBox } from '../xrd/MethodDetails';
import { NumberInput } from '../xrd/NumberInput';
import { sigmoidTypeFor, type BandGapAnalysis } from './analysis';
import type { BandGapChoice, UvvisData } from './data';
import { codyLabels, edgeLabels } from './labels';
import { gapText } from './tables';

const eV = (value: number, digits = 3) => Number(value.toFixed(digits));
/** Smallest allowed width of a fit region, eV. */
const MIN_REGION = 0.02;

interface ExtraProps {
  analysis: BandGapAnalysis;
  choice: BandGapChoice;
  data: UvvisData;
  update: StepContext<UvvisData>['update'];
  change: (patch: Partial<BandGapChoice>) => void;
  name: string;
}

function finiteSource(
  id: string,
  name: string,
  x: Float64Array,
  y: Float64Array,
  extra: Partial<SeriesSource> = {},
): SeriesSource {
  const keep: number[] = [];
  for (let i = 0; i < y.length; i++)
    if (Number.isFinite(y[i]) && Number.isFinite(x[i])) keep.push(i);
  return {
    id,
    name,
    x: Float64Array.from(keep, (i) => x[i] as number),
    y: Float64Array.from(keep, (i) => y[i] as number),
    unit: '',
    ...extra,
  };
}

function valueAt(x: Float64Array, y: Float64Array, at: number): number {
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs((x[i] as number) - at);
    if (d < distance && Number.isFinite(y[i])) {
      distance = d;
      best = y[i] as number;
    }
  }
  return best;
}

/** Moves one end of a region, keeping it at least MIN_REGION wide. */
function dragged(region: [number, number], index: number, x: number): [number, number] {
  const next: [number, number] = [region[0], region[1]];
  next[index] =
    index === 0 ? Math.min(x, region[1] - MIN_REGION) : Math.max(x, region[0] + MIN_REGION);
  return [eV(next[0], 4), eV(next[1], 4)];
}

/** Difference to the Tauc value, for example "+0.012 eV from the Tauc value". */
function againstTauc(value: number, tauc: number | undefined): string {
  if (tauc === undefined) return '';
  const d = value - tauc;
  return ` (${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(3)} eV from the Tauc value)`;
}

/** Cross-check switches and the Cody and sigmoid results, each with its own plot. */
export function CrossChecks(props: ExtraProps) {
  const { choice, change } = props;
  return (
    <>
      <div class="radiation-fields">
        <label class="check">
          <input
            type="checkbox"
            checked={choice.cody.enabled}
            onChange={(e) => change({ cody: { ...choice.cody, enabled: e.currentTarget.checked } })}
          />
          Cody plot
        </label>
        <HelpTip term="Cody plot">
          <p>
            The Cody plot draws (α/hν)^(1/2) against hν in place of the Tauc (αhν)^(1/2). It assumes
            that the dipole matrix element of the transition, not the momentum matrix element, is
            independent of energy (G. D. Cody, as discussed by A. R. Zanatta, Sci. Rep. 9 (2019)
            11225). It is used mainly for amorphous semiconductors and usually curves less than the
            Tauc plot. Eg is where its straight part meets zero. An estimate to compare with the
            Tauc value, not a replacement.
          </p>
        </HelpTip>
        <label class="check">
          <input
            type="checkbox"
            checked={choice.sigmoid.enabled}
            onChange={(e) =>
              change({ sigmoid: { ...choice.sigmoid, enabled: e.currentTarget.checked } })
            }
          />
          Sigmoid (Boltzmann) fit
        </label>
        <HelpTip term="sigmoid fit">
          <p>
            Zanatta (Sci. Rep. 9 (2019) 11225) fits the absorption edge itself with a sigmoid, S(E)
            = S<sub>max</sub> + (S<sub>min</sub> − S<sub>max</sub>)/(1 + exp((E − E<sub>0</sub>
            )/δE)), over about 0.5 eV around its middle, and estimates the gap as E<sub>g</sub> = E
            <sub>0</sub> − n·δE. The constant n (0.3 direct, 4.3 indirect, 3.6 amorphous) was found
            empirically from Ge, Si and GaAs samples in that paper. It needs no choice of a straight
            region and no exponent, but it is an empirical estimate.
          </p>
        </HelpTip>
      </div>
      {choice.cody.enabled && <CodySection {...props} />}
      {choice.sigmoid.enabled && <SigmoidSection {...props} />}
    </>
  );
}

function CodySection({ analysis, choice, data, update, change, name }: ExtraProps) {
  const cody = analysis.cody;
  const { signal } = analysis;
  const fit = cody?.fit ?? null;
  const region = cody?.region ?? null;
  const sources = useMemo(() => {
    if (!cody) return [];
    const list = [finiteSource('cody', 'Cody curve', signal.energyEv, cody.cody)];
    if (fit) {
      const end = fit.toEv + 0.1;
      list.push({
        id: 'cody-fit',
        name: `Linear fit, Eg = ${eV(fit.egEv)} eV`,
        x: Float64Array.from([fit.egEv, end]),
        y: Float64Array.from([0, fit.slope * (end - fit.egEv)]),
        unit: '',
        colorIndex: 1,
        dashed: true,
      });
    }
    return list;
  }, [cody, fit, signal]);
  const labels = useMemo(() => codyLabels(signal.unit), [signal.unit]);
  if (!cody) return null;
  const markers: PlotMarker[] = region
    ? region.map((x) => ({ x, y: valueAt(signal.energyEv, cody.cody, x) }))
    : [];
  return (
    <div class="urbach">
      <h4 class="export-title">Cody plot (estimate)</h4>
      {fit ? (
        <p>
          Cody gap E<sub>g</sub> = <strong>{gapText(fit)} eV</strong>
          {againstTauc(fit.egEv, analysis.fit?.egEv)}, from a straight line over {eV(fit.fromEv)} to{' '}
          {eV(fit.toEv)} eV ({fit.n} points, R² = {fit.rSquared.toFixed(4)}
          {cody.suggested ? ', region suggested automatically' : ', region set by you'}). Read where
          the line meets zero, with no sub-gap correction.
        </p>
      ) : (
        <p class="message is-warning">
          <strong>Check:</strong> no rising straight line could be fitted to the Cody curve. Drag
          the markers over its straight part.
        </p>
      )}
      {!cody.suggested && (
        <button
          type="button"
          class="btn btn-quiet"
          onClick={() => change({ cody: { ...choice.cody, region: null } })}
        >
          Use the suggested Cody region again
        </button>
      )}
      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
        labels={() => labels}
        xName="E"
        xUnit=" eV"
        exportName={`${name}-cody`}
        showOverlayOptions={false}
        interaction={{
          markers,
          onMarkerDrag: (index, x) =>
            region && change({ cody: { ...choice.cody, region: dragged(region, index, x) } }),
          hint: 'Drag the round markers to change the Cody fit region.',
        }}
      />
    </div>
  );
}

function SigmoidSection({ analysis, choice, data, update, change, name }: ExtraProps) {
  const sigmoid = analysis.sigmoid;
  const { signal } = analysis;
  const fit = sigmoid?.fit ?? null;
  const range = sigmoid?.range ?? null;
  const sources = useMemo(() => {
    const list = [finiteSource('edge', 'Absorption edge', signal.energyEv, signal.signal)];
    if (fit)
      list.push({
        id: 'sigmoid',
        name: `Sigmoid fit, E0 = ${eV(fit.e0Ev)} eV`,
        x: fit.energyEv,
        y: fit.model,
        unit: '',
        colorIndex: 1,
        dashed: true,
      });
    return list;
  }, [fit, signal]);
  const labels = useMemo(() => edgeLabels(signal.unit), [signal.unit]);
  if (!sigmoid) return null;
  const markers: PlotMarker[] = range
    ? range.map((x) => ({ x, y: valueAt(signal.energyEv, signal.signal, x) }))
    : [];
  const typeFollows = choice.sigmoid.type === null;
  return (
    <div class="urbach">
      <h4 class="export-title">Sigmoid fit (estimate)</h4>
      <div class="radiation-fields">
        <label class="inline-field">
          Type for n
          <select
            value={choice.sigmoid.type ?? 'follow'}
            onChange={(e) => {
              const v = e.currentTarget.value;
              change({
                sigmoid: { ...choice.sigmoid, type: v === 'follow' ? null : (v as SigmoidType) },
              });
            }}
          >
            <option value="follow">
              As the Tauc transition (now: {SIGMOID_LABELS[sigmoidTypeFor(choice.transition)]})
            </option>
            {(Object.keys(SIGMOID_N) as SigmoidType[]).map((t) => (
              <option key={t} value={t}>
                {SIGMOID_LABELS[t]}, n = {SIGMOID_N[t]}
              </option>
            ))}
          </select>
        </label>
        {range && (
          <>
            <NumberInput
              label="Fit from (eV)"
              value={eV(range[0])}
              onChange={(v) =>
                v !== null &&
                v < range[1] - MIN_REGION &&
                change({ sigmoid: { ...choice.sigmoid, range: [v, range[1]] } })
              }
            />
            <NumberInput
              label="Fit to (eV)"
              value={eV(range[1])}
              onChange={(v) =>
                v !== null &&
                v > range[0] + MIN_REGION &&
                change({ sigmoid: { ...choice.sigmoid, range: [range[0], v] } })
              }
            />
          </>
        )}
      </div>
      {fit ? (
        <p>
          E<sub>0</sub> = {eV(fit.e0Ev)} ± {eV(fit.e0Sigma, 4)} eV, δE = {eV(fit.deltaEv, 4)} ±{' '}
          {eV(fit.deltaSigma, 4)} eV, so E<sub>g</sub> = E<sub>0</sub> − {SIGMOID_N[fit.type]}·δE ={' '}
          <strong>{gapText({ egEv: fit.egEv, egSigma: fit.egSigma })} eV</strong>
          {againstTauc(fit.egEv, analysis.fit?.egEv)} ({SIGMOID_LABELS[fit.type].toLowerCase()},{' '}
          {fit.n} points from {eV(fit.fromEv)} to {eV(fit.toEv)} eV, R² = {fit.rSquared.toFixed(4)}
          {fit.suggested ? ', range suggested automatically' : ', range set by you'}
          {typeFollows ? '' : ', type set by you'}).
        </p>
      ) : (
        <p class="message is-warning">
          <strong>Check:</strong>{' '}
          {range
            ? 'the sigmoid could not be fitted in this range (it needs at least 8 points and an edge that rises, with its middle inside the range). Widen or move the range.'
            : 'the default range is placed around the Tauc band gap, so the Tauc fit must work first. Or type a range.'}
        </p>
      )}
      {!range && (
        <button
          type="button"
          class="btn btn-quiet"
          onClick={() => {
            const e = analysis.signal.energyEv;
            const mid = ((e[0] as number) + (e[e.length - 1] as number)) / 2;
            change({ sigmoid: { ...choice.sigmoid, range: [eV(mid - 0.25), eV(mid + 0.25)] } });
          }}
        >
          Set a range by hand
        </button>
      )}
      {choice.sigmoid.range !== null && (
        <button
          type="button"
          class="btn btn-quiet"
          onClick={() => change({ sigmoid: { ...choice.sigmoid, range: null } })}
        >
          Use the suggested range again
        </button>
      )}
      <p class="field-hint">
        The suggested range is 0.5 eV centred where the edge first rises past halfway between its
        lowest and highest value within 0.5 eV of the Tauc gap. The ± values are standard errors of
        the fit only; the constant n carries its own, unstated, uncertainty.
      </p>
      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
        labels={() => labels}
        xName="E"
        xUnit=" eV"
        exportName={`${name}-sigmoid`}
        showOverlayOptions={false}
        interaction={{
          markers,
          onMarkerDrag: (index, x) =>
            range && change({ sigmoid: { ...choice.sigmoid, range: dragged(range, index, x) } }),
          hint: 'Drag the round markers to change the sigmoid fit range.',
        }}
      />
    </div>
  );
}

/** Extinction coefficient k(λ) of a film, when α is absolute. */
export function extinctionRows(
  analysis: BandGapAnalysis,
): { nm: number; alpha: number; k: number }[] {
  if (analysis.signal.unit !== 'alpha' || analysis.sample !== 'film') return [];
  const { energyEv, signal } = analysis.signal;
  const rows: { nm: number; alpha: number; k: number }[] = [];
  for (let i = energyEv.length - 1; i >= 0; i--) {
    const alpha = signal[i] as number;
    if (!Number.isFinite(alpha)) continue;
    const nm = HC_EV_NM / (energyEv[i] as number);
    rows.push({ nm, alpha, k: extinctionCoefficient(alpha, nm) });
  }
  return rows;
}

/** k(λ) and n estimated from Eg, with their equations, assumptions and ranges. */
export function OpticalConstants({
  analysis,
  data,
  update,
  name,
}: Omit<ExtraProps, 'choice' | 'change'>) {
  const rows = useMemo(() => extinctionRows(analysis), [analysis]);
  const sources = useMemo(
    () => [
      {
        id: 'k',
        name: 'Extinction coefficient k',
        x: Float64Array.from(rows, (r) => r.nm),
        y: Float64Array.from(rows, (r) => r.k),
        unit: '',
      },
    ],
    [rows],
  );
  const eg = analysis.fit?.egEv;
  return (
    <section class="process-step" aria-labelledby="optics-title">
      <h3 id="optics-title" class="process-step-title">
        Optical constants (optional)
      </h3>
      <h4 class="export-title">
        Extinction coefficient k{' '}
        <HelpTip term="extinction coefficient">
          <p>
            k = αλ/(4π), with α in cm⁻¹ and λ converted to cm, so k has no unit (from α = 4πk/λ). It
            needs α in absolute units, so a film with its thickness, and inherits everything that
            went into α: a wrong thickness or an uncorrected reflection changes k in proportion.
          </p>
        </HelpTip>
      </h4>
      {rows.length > 0 ? (
        <>
          <p class="field-hint">
            k = αλ/(4π) from the α of the Tauc plot
            {analysis.reflection?.state === 'corrected'
              ? ', corrected for reflection'
              : ', not corrected for reflection, so overestimated where the film reflects'}
            .
          </p>
          <TableBox
            label="Extinction coefficient"
            compact
            onExport={() =>
              downloadCsv(
                `${name}-extinction-coefficient`,
                `Extinction coefficient k = alpha*lambda/(4*pi) of ${name}; alpha in cm-1 from ${analysis.reflection?.state === 'corrected' ? 'T and R (reflection corrected)' : 'alpha = ln(10)*A/t (no reflection correction)'}.`,
                rows,
                [
                  { header: 'Wavelength (nm)', value: (r) => r.nm },
                  { header: 'alpha (cm-1)', value: (r) => r.alpha },
                  { header: 'k', value: (r) => r.k },
                ],
              )
            }
          >
            <thead>
              <tr>
                <th scope="col">Range (nm)</th>
                <th scope="col">Points</th>
                <th scope="col">Largest k</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  {(rows[0] as { nm: number }).nm.toFixed(1)} to{' '}
                  {(rows[rows.length - 1] as { nm: number }).nm.toFixed(1)}
                </td>
                <td>{rows.length}</td>
                <td>{Math.max(...rows.map((r) => r.k)).toPrecision(3)}</td>
              </tr>
            </tbody>
          </TableBox>
          <PlotPanel
            sources={sources}
            settings={data.plot}
            onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
            labels={() => ({ x: 'Wavelength (nm)', y: 'Extinction coefficient k', yValues: true })}
            xName="λ"
            xUnit=" nm"
            exportName={`${name}-k`}
            showOverlayOptions={false}
          />
        </>
      ) : (
        <p class="field-hint">
          {analysis.sample === 'solution'
            ? 'k describes a solid film; for a solution α is that of the whole liquid, so k is not given.'
            : 'Give the film thickness above to calculate k; it needs α in cm⁻¹.'}
        </p>
      )}
      <h4 class="export-title">
        Refractive index from E<sub>g</sub> (rough empirical estimates){' '}
        <HelpTip term="refractive index from the band gap">
          <p>
            These relations were fitted to many semiconductors and give a long-wavelength refractive
            index from the band gap alone. They can be wrong by 10 % or more for a given material
            and say nothing about dispersion. Use them only when no measured n is available, and say
            so.
          </p>
        </HelpTip>
      </h4>
      {eg !== undefined ? <IndexTable eg={eg} /> : <p class="field-hint">Needs a Tauc band gap.</p>}
    </section>
  );
}

function IndexTable({ eg }: { eg: number }) {
  const relations = Object.keys(INDEX_RELATIONS) as IndexRelation[];
  return (
    <div class="table-scroll" tabIndex={0} role="region" aria-label="Refractive index estimates">
      <table class="peak-table">
        <thead>
          <tr>
            <th scope="col">Relation</th>
            <th scope="col">Equation</th>
            <th scope="col">n (estimate)</th>
            <th scope="col">Valid range and source</th>
          </tr>
        </thead>
        <tbody>
          {relations.map((r) => {
            const info = INDEX_RELATIONS[r];
            const n = indexFromGap(r, eg);
            return (
              <tr key={r}>
                <th scope="row">{info.label}</th>
                <td>{info.equation}</td>
                <td>
                  {Number.isFinite(n) ? n.toFixed(3) : '–'}
                  {!inIndexRange(r, eg) && (
                    <span class="message is-warning">
                      {' '}
                      Outside the stated range for E<sub>g</sub> = {eg.toFixed(3)} eV.
                    </span>
                  )}
                </td>
                <td>
                  {info.validity}. {info.source}.
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
