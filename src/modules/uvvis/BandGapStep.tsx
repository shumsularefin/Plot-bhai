import { useMemo, useState } from 'preact/hooks';
import { energyFromWavelength } from '../../core/uvvis/conversions';
import {
  automaticGapMethod,
  GAP_METHODS,
  TRANSITIONS,
  type GapMethod,
  type TransitionId,
} from '../../core/uvvis/tauc';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { PlotMarker } from '../../ui/plot/types';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import {
  analyseBandGap,
  cleanAll,
  componentFor,
  fitMessages,
  type BandGapAnalysis,
} from './analysis';
import { bandGapFor, type BandGapChoice, type UvvisData } from './data';
import { taucLabels, urbachLabels } from './labels';
import { gapText } from './tables';

const eV = (value: number, digits = 3) => Number(value.toFixed(digits));
/** Smallest allowed width of a fit region, eV. */
const MIN_REGION = 0.02;

/** Values of a curve at the point nearest to x; 0 where the curve is undefined there. */
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

function curveSource(
  id: string,
  name: string,
  x: Float64Array,
  y: Float64Array,
  extra: Partial<SeriesSource> = {},
): SeriesSource {
  const keep: number[] = [];
  for (let i = 0; i < y.length; i++) if (Number.isFinite(y[i])) keep.push(i);
  return {
    id,
    name,
    x: Float64Array.from(keep, (i) => x[i] as number),
    y: Float64Array.from(keep, (i) => y[i] as number),
    unit: '',
    ...extra,
  };
}

/** Wizard step 3: Tauc band gap with a draggable fit region, the four transitions, Urbach energy. */
export function BandGapStep({ data, update }: StepContext<UvvisData>) {
  const spectra = data.spectra;
  const [selectedId, setSelectedId] = useState(spectra[0]?.id);
  const spectrum = spectra.find((s) => s.id === selectedId) ?? spectra[0];
  const { cleaning } = data;
  const cleaned = useMemo(() => cleanAll(spectra, cleaning), [spectra, cleaning]);
  const cleanedSpectrum = spectrum ? cleaned[spectra.indexOf(spectrum)] : undefined;
  const choice = spectrum ? bandGapFor(data, spectrum.id) : undefined;

  const analysis = useMemo(
    () =>
      spectrum && cleanedSpectrum && choice
        ? analyseBandGap(
            spectrum,
            cleanedSpectrum,
            choice,
            componentFor(spectra, cleaned, choice, spectrum.id),
          )
        : null,
    [spectrum, cleanedSpectrum, choice, spectra, cleaned],
  );

  if (!spectrum || !analysis || !choice) {
    return <p>No spectra are loaded. Go back to Upload to add one.</p>;
  }

  const change = (patch: Partial<BandGapChoice>) =>
    update({ bandGap: { ...data.bandGap, [spectrum.id]: { ...choice, ...patch } } });
  /** Any change to how Eg is read, or to its regions, ends the saved session's old suggestion. */
  const changeGap = (patch: Partial<BandGapChoice>) => {
    const { legacySuggestion: _legacy, ...rest } = choice;
    void _legacy;
    update({ bandGap: { ...data.bandGap, [spectrum.id]: { ...rest, ...patch } } });
  };
  const setRegion = (region: [number, number] | null) => {
    const regions = Object.fromEntries(
      Object.entries(choice.regions).filter(([id]) => id !== choice.transition),
    );
    changeGap({ regions: region ? { ...regions, [choice.transition]: region } : regions });
  };

  return (
    <div class="clean-step">
      {spectra.length > 1 && (
        <div class="clean-toolbar">
          <label class="inline-field">
            Spectrum
            <select value={spectrum.id} onChange={(e) => setSelectedId(e.currentTarget.value)}>
              {spectra.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p class="field-hint">
        The band gap is estimated from the cleaned spectrum of step 2. Each spectrum has its own
        settings below.
      </p>

      <section class="process-step is-on" aria-labelledby="tauc-title">
        <h3 id="tauc-title" class="process-step-title">
          Tauc plot{' '}
          <HelpTip term="Tauc plot">
            <p>
              Near the absorption edge, (αhν)^(1/n) is a straight line against photon energy hν. The
              band gap is where that line meets the energy axis (or a baseline, see below). The
              exponent n depends on the type of electronic transition: 1/2 for direct allowed, 2 for
              indirect allowed, 3/2 for direct forbidden and 3 for indirect forbidden. Which one
              fits your material should come from the literature, not from which line looks
              straightest.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <label class="inline-field">
            Transition type
            <select
              value={choice.transition}
              onChange={(e) => change({ transition: e.currentTarget.value as TransitionId })}
            >
              {(Object.keys(TRANSITIONS) as TransitionId[]).map((id) => (
                <option key={id} value={id}>
                  {TRANSITIONS[id].label} (n = {TRANSITIONS[id].nText})
                </option>
              ))}
            </select>
          </label>
          {spectrum.kind !== 'reflectance' && (
            <>
              <NumberInput
                label="Film thickness (nm, optional)"
                value={choice.thicknessNm}
                min={0}
                onChange={(thicknessNm) => change({ thicknessNm })}
              />
              <HelpTip term="film thickness">
                <p>
                  With a thickness t, the absorption coefficient is α = ln(10) · A / t, in cm⁻¹.
                  Without it the absorbance itself is used and the vertical axis is only
                  proportional to the true quantity. The band gap is the same either way.
                </p>
              </HelpTip>
            </>
          )}
        </div>
        {spectrum.kind === 'reflectance' && (
          <p class="field-hint">
            Diffuse reflectance: the Kubelka–Munk function F(R) is used in place of α, so no
            thickness is needed.
          </p>
        )}
        {spectrum.kind === 'absorbance' && /\bdrs\b|diffuse|reflect/i.test(spectrum.name) && (
          <p class="message is-warning">
            <strong>Check:</strong> the name suggests diffuse reflectance, but the values are
            treated as transmission absorbance. Diffuse-reflectance software often exports
            log₁₀(1/R), which is not proportional to the absorption coefficient; for powders the
            Kubelka–Munk function F(R) is the usual choice. If the instrument can export %R, load
            that as reflectance. Otherwise state in your paper that the Tauc plot used log₁₀(1/R),
            because the two give different band gaps.
          </p>
        )}
        <GapMethodChoice
          analysis={analysis}
          choice={choice}
          others={spectra.filter((s) => s.id !== spectrum.id)}
          onMethod={(method) => changeGap({ method })}
          onBaseline={(baselineRegion) => changeGap({ baselineRegion })}
          onComponent={(component) => changeGap({ component })}
        />
        <TaucResult analysis={analysis} onReset={() => setRegion(null)} />
        {choice.legacySuggestion && (
          <p class="field-hint">
            This spectrum was saved before the baseline methods existed, so its fit region is still
            suggested the old way and its band gap is unchanged. Choosing how Eg is read, or moving
            a region, updates it.
          </p>
        )}
      </section>

      <TaucPlot
        analysis={analysis}
        choice={choice}
        data={data}
        update={update}
        onRegion={setRegion}
        onBaseline={(baselineRegion) => changeGap({ baselineRegion })}
        name={spectrum.name}
      />

      <ComparisonTable
        analysis={analysis}
        selected={choice.transition}
        onChoose={(id) => change({ transition: id })}
      />

      <section class="process-step" aria-labelledby="extra-title">
        <h3 id="extra-title" class="process-step-title">
          Other estimates (optional)
        </h3>
        <div class="radiation-fields">
          <label class="check">
            <input
              type="checkbox"
              checked={choice.urbach.enabled}
              onChange={(e) =>
                change({ urbach: { ...choice.urbach, enabled: e.currentTarget.checked } })
              }
            />
            Urbach energy
          </label>
          <HelpTip term="Urbach energy">
            <p>
              Below the gap, many materials absorb with an exponential tail, α ∝ exp(E/Eu). The
              Urbach energy Eu (the inverse slope of ln α against E) measures how wide that tail is,
              which grows with structural or thermal disorder. It needs a straight stretch of ln α
              below the edge; drag the markers to choose it.
            </p>
          </HelpTip>
          <label class="inline-field">
            Derivative method
            <select
              value={choice.derivative}
              onChange={(e) =>
                change({ derivative: e.currentTarget.value as BandGapChoice['derivative'] })
              }
            >
              <option value="off">Off</option>
              <option value="linear">Maximum of dS/dE</option>
              <option value="log">Maximum of d(ln S)/dE</option>
            </select>
          </label>
          <HelpTip term="derivative method">
            <p>
              S is the plotted absorption quantity (α, A or F(R)). The energy where S rises fastest
              is another way to mark the edge. It is not the same as the Tauc gap: for real spectra
              it usually lies a little higher. Use it as a cross-check, and report which method gave
              which number.
            </p>
          </HelpTip>
        </div>
        {analysis.derivative && (
          <p>
            Steepest rise of {choice.derivative === 'log' ? 'ln S' : 'S'} at{' '}
            <strong>{eV(analysis.derivative.egEv)} eV</strong> (
            {eV(energyFromWavelength(analysis.derivative.egEv), 1)} nm). Searched within 0.3 eV of
            the Tauc fit region.
          </p>
        )}
        {analysis.derivative?.atEdge && (
          <p class="message is-warning">
            <strong>Check:</strong> the steepest rise is at the end of the searched range, so the
            derivative is still increasing there and the steepest part of the edge lies outside it
            (or the spectrum saturates). This value is not an estimate of the band gap.
          </p>
        )}
        {choice.derivative !== 'off' && !analysis.derivative && (
          <p class="message is-warning">
            <strong>Check:</strong> no derivative could be calculated in the search range.
          </p>
        )}
        {analysis.urbach && (
          <UrbachSection
            analysis={analysis}
            choice={choice}
            data={data}
            update={update}
            onRegion={(region) => change({ urbach: { ...choice.urbach, region } })}
          />
        )}
      </section>
    </div>
  );
}

function TaucResult({ analysis, onReset }: { analysis: BandGapAnalysis; onReset: () => void }) {
  const { fit } = analysis;
  const messages = fitMessages(analysis);
  return (
    <>
      {fit && (
        <dl class="summary-grid" aria-label="Band gap result">
          <div>
            <dt>
              Band gap E<sub>g</sub> (estimate)
            </dt>
            <dd>{gapText(fit)} eV</dd>
          </div>
          <div>
            <dt>Absorption edge</dt>
            <dd>{eV(energyFromWavelength(fit.egEv), 1)} nm</dd>
          </div>
          <div>
            <dt>How Eg is read</dt>
            <dd>
              {GAP_METHODS[analysis.method].label}
              {analysis.automatic ? ' (automatic)' : ''}
            </dd>
          </div>
          <div>
            <dt>R² of the line</dt>
            <dd>{fit.rSquared.toFixed(4)}</dd>
          </div>
          <div>
            <dt>Fit region</dt>
            <dd>
              {eV(fit.fromEv)} to {eV(fit.toEv)} eV ({fit.n} points)
            </dd>
          </div>
        </dl>
      )}
      <p class="field-hint">
        {analysis.suggested
          ? 'The fit region is an automatic suggestion (the widest straight stretch of the curve). '
          : 'The fit region was set by you. '}
        Drag the two round markers on the plot to change it.{' '}
        {!analysis.suggested && (
          <button type="button" class="btn btn-quiet" onClick={onReset}>
            Use the suggestion again
          </button>
        )}
      </p>
      {fit && (
        <p class="field-hint">
          The ± is the statistical uncertainty of the straight-line fit
          {analysis.method === 'axis'
            ? ''
            : analysis.method === 'subtract-component'
              ? ' and of the factor c'
              : 's (edge and baseline)'}{' '}
          only. It is smaller than the true uncertainty, which also depends on the regions you
          choose.
        </p>
      )}
      {messages.length > 0 && (
        <ul class="pattern-messages">
          {messages.map((m, i) => (
            <li key={i} class={`message is-${m.level}`}>
              <strong>{m.level === 'warning' ? 'Check' : 'Note'}:</strong> {m.text}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface PlotStepProps {
  analysis: BandGapAnalysis;
  choice: BandGapChoice;
  data: UvvisData;
  update: StepContext<UvvisData>['update'];
}

function TaucPlot({
  analysis,
  choice,
  data,
  update,
  onRegion,
  onBaseline,
  name,
}: PlotStepProps & {
  onRegion: (region: [number, number]) => void;
  onBaseline: (region: [number, number]) => void;
  name: string;
}) {
  const { fit, signal, region, tauc, method, taucCorrected, taucBaseline, baselineRegion } =
    analysis;
  // The curve the edge line is fitted to: the corrected one when something is subtracted.
  const corrected =
    method === 'subtract-baseline'
      ? taucCorrected
      : method === 'subtract-component'
        ? analysis.taucComponent
        : null;
  const subtracted = corrected !== null;
  const fitted = corrected ?? tauc;
  const showBaseline =
    method !== 'axis' &&
    baselineRegion !== null &&
    !(method === 'subtract-component' && analysis.componentFactor?.n === 0);
  const sources = useMemo(() => {
    const list: SeriesSource[] = [
      curveSource(
        'tauc',
        subtracted ? 'Tauc curve, as measured' : 'Tauc curve',
        signal.energyEv,
        tauc,
      ),
    ];
    if (corrected) {
      list.push(
        curveSource(
          'corrected',
          method === 'subtract-component'
            ? 'Tauc curve, second component subtracted'
            : 'Tauc curve, sub-gap baseline subtracted',
          signal.energyEv,
          corrected,
          { colorIndex: 2 },
        ),
      );
    }
    if (fit) {
      const end = fit.toEv + 0.1;
      const line = (e: number) => fit.intercept + fit.slope * e;
      list.push({
        id: 'fit',
        name: `${method === 'baseline-crossing' ? 'Edge line' : 'Linear fit'}, Eg = ${eV(fit.egEv)} eV`,
        x: Float64Array.from([fit.egEv, end]),
        y: Float64Array.from(
          method === 'baseline-crossing'
            ? [line(fit.egEv), line(end)]
            : [0, line(end) - line(fit.egEv)],
        ),
        unit: '',
        colorIndex: 1,
        dashed: true,
      });
    }
    if (method === 'baseline-crossing' && taucBaseline && baselineRegion) {
      const to = fit ? fit.egEv : baselineRegion[1];
      const line = (e: number) => taucBaseline.intercept + taucBaseline.slope * e;
      list.push({
        id: 'baseline',
        name: 'Baseline line on the Tauc plot',
        x: Float64Array.from([baselineRegion[0], to]),
        y: Float64Array.from([line(baselineRegion[0]), line(to)]),
        unit: '',
        colorIndex: 3,
        dashed: true,
      });
    }
    return list;
  }, [signal, tauc, corrected, subtracted, fit, method, taucBaseline, baselineRegion]);
  const labels = useMemo(
    () => taucLabels(choice.transition, signal.unit),
    [choice.transition, signal.unit],
  );
  const markers: PlotMarker[] = [
    ...(region ? region.map((x) => ({ x, y: valueAt(signal.energyEv, fitted, x) })) : []),
    ...(showBaseline && baselineRegion
      ? baselineRegion.map((x) => ({ x, y: valueAt(signal.energyEv, tauc, x) }))
      : []),
  ];
  const edgeCount = region ? 2 : 0;
  const drag = (index: number, x: number) => {
    const isBaseline = index >= edgeCount;
    const current = isBaseline ? baselineRegion : region;
    if (!current) return;
    const i = isBaseline ? index - edgeCount : index;
    const next: [number, number] = [current[0], current[1]];
    next[i] = i === 0 ? Math.min(x, current[1] - MIN_REGION) : Math.max(x, current[0] + MIN_REGION);
    (isBaseline ? onBaseline : onRegion)([eV(next[0], 4), eV(next[1], 4)]);
  };
  return (
    <PlotPanel
      sources={sources}
      settings={data.plot}
      onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
      labels={() => labels}
      xName="E"
      xUnit=" eV"
      exportName={`${name}-tauc`}
      showOverlayOptions={false}
      interaction={{
        markers,
        onMarkerDrag: drag,
        hint: showBaseline
          ? 'Drag the round markers to change the edge region (the upper pair) and the baseline region (the lower pair). Pinch or Ctrl and scroll to zoom.'
          : 'Drag the round markers to change the fit region. Pinch or Ctrl and scroll to zoom.',
      }}
    />
  );
}

/** How Eg is read from the Tauc line, and the sub-gap baseline region the two baseline methods use. */
function GapMethodChoice({
  analysis,
  choice,
  others,
  onMethod,
  onBaseline,
  onComponent,
}: {
  analysis: BandGapAnalysis;
  choice: BandGapChoice;
  others: readonly { id: string; name: string }[];
  onMethod: (method: GapMethod | null) => void;
  onBaseline: (region: [number, number] | null) => void;
  onComponent: (component: BandGapChoice['component']) => void;
}) {
  const region = analysis.baselineRegion;
  const usesComponent = analysis.method === 'subtract-component';
  const typedFactor = choice.component?.factor ?? null;
  const usesBaseline = analysis.method !== 'axis' && !(usesComponent && typedFactor !== null);
  const setLimit = (index: 0 | 1, value: number | null) => {
    if (value === null || !region) return;
    const next: [number, number] = [region[0], region[1]];
    next[index] = value;
    if (next[1] - next[0] >= MIN_REGION) onBaseline(next);
  };
  return (
    <div class="radiation-fields">
      <label class="inline-field">
        How Eg is read
        <select
          value={choice.method ?? 'auto'}
          onChange={(e) => {
            const v = e.currentTarget.value;
            onMethod(v === 'auto' ? null : (v as GapMethod));
          }}
        >
          <option value="auto">
            Automatic (now: {GAP_METHODS[automaticGapMethod(analysis.subGapLevel)].short})
          </option>
          {(Object.keys(GAP_METHODS) as GapMethod[]).map((id) => (
            <option key={id} value={id}>
              {GAP_METHODS[id].label}
            </option>
          ))}
        </select>
      </label>
      <HelpTip term="how Eg is read">
        <p>
          Axis intercept: Eg is where the straight edge line meets zero. That is right only when the
          curve falls to zero below the edge. Scattering, a second phase, defects or an imperfect
          blank leave a level below the edge, and the line then meets the axis below the true gap.
        </p>
        <p>
          Sub-gap baseline subtracted first: a straight line is fitted to the absorption quantity
          (α, A or F(R)) in a region below the edge and subtracted before the Tauc plot is made.
          This assumes the background adds to the absorption and changes linearly with energy across
          the edge. Automatic uses it when it moves Eg by more than 0.01 eV.
        </p>
        <p>
          Crossing with a baseline: a second line is fitted to the Tauc curve below the edge, and Eg
          is where the two lines cross (the simplified procedure of Makuła, Pacia and Macyk, J.
          Phys. Chem. Lett. 9 (2018) 6814). Because the Tauc curve of an edge plus a level is bent,
          the crossing can differ from the gap by a few hundredths of an eV.
        </p>
        <p>
          Spectrum of a second component subtracted first: when the sample is a semiconductor with a
          dye, modifier or support that you have also measured on its own, its spectrum, scaled by a
          factor c, is subtracted before the Tauc plot, α<sub>s</sub> = α − c·α<sub>m</sub>. Makuła
          and co-workers found this the most accurate way. c is fitted over the baseline region,
          where only the second component absorbs, or typed by you.
        </p>
      </HelpTip>
      {usesComponent && (
        <>
          <label class="inline-field">
            Second component
            <select
              value={choice.component?.spectrumId ?? ''}
              onChange={(e) => {
                const id = e.currentTarget.value;
                onComponent(id ? { spectrumId: id, factor: typedFactor } : null);
              }}
            >
              <option value="">Choose a spectrum</option>
              {others.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {choice.component && (
            <NumberInput
              label="Factor c (empty: fitted)"
              value={typedFactor}
              onChange={(factor) =>
                choice.component && onComponent({ ...choice.component, factor })
              }
            />
          )}
          {others.length === 0 && (
            <p class="field-hint">
              Only one spectrum is loaded. Go back to Upload and add the spectrum of the second
              component, measured the same way.
            </p>
          )}
        </>
      )}
      {usesBaseline && region && (
        <>
          <NumberInput
            label="Baseline from (eV)"
            value={eV(region[0], 3)}
            onChange={(v) => setLimit(0, v)}
          />
          <NumberInput
            label="Baseline to (eV)"
            value={eV(region[1], 3)}
            onChange={(v) => setLimit(1, v)}
          />
          <p class="field-hint">
            {analysis.baselineSuggested
              ? 'The baseline region is an automatic suggestion: 0.5 eV ending 0.1 eV below the gap. Choose a stretch with no absorption of its own (no tail or second edge).'
              : 'The baseline region was set by you. '}
            {!analysis.baselineSuggested && (
              <button type="button" class="btn btn-quiet" onClick={() => onBaseline(null)}>
                Use the suggested baseline again
              </button>
            )}
          </p>
        </>
      )}
    </div>
  );
}

function ComparisonTable({
  analysis,
  selected,
  onChoose,
}: {
  analysis: BandGapAnalysis;
  selected: TransitionId;
  onChoose: (id: TransitionId) => void;
}) {
  return (
    <section class="peak-table-section" aria-labelledby="compare-title">
      <h3 id="compare-title" class="process-step-title">
        All four transition types side by side{' '}
        <HelpTip term="comparing transition types">
          <p>
            Each type is fitted over its own region (yours, or the suggestion) and Eg is read the
            same way as above, so the numbers are not directly comparable in quality. A higher R²
            does not prove which transition a material has; several can look almost equally
            straight.
          </p>
        </HelpTip>
      </h3>
      <p class="message">
        <strong>Guide only:</strong> choose the transition type from the literature for your
        material, not from the highest R².
      </p>
      <div
        class="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Transition comparison, scrolls sideways"
      >
        <table class="peak-table">
          <thead>
            <tr>
              <th scope="col">Transition</th>
              <th scope="col">n</th>
              <th scope="col">
                E<sub>g</sub> (eV)
              </th>
              <th scope="col">R²</th>
              <th scope="col">Region (eV)</th>
              <th scope="col">Eg read from</th>
              <th scope="col">Use</th>
            </tr>
          </thead>
          <tbody>
            {analysis.comparison.map(({ id, fit, method }) => (
              <tr key={id}>
                <th scope="row">{TRANSITIONS[id].label}</th>
                <td>{TRANSITIONS[id].nText}</td>
                <td>{fit ? gapText(fit) : '–'}</td>
                <td>{fit ? fit.rSquared.toFixed(4) : '–'}</td>
                <td>{fit ? `${eV(fit.fromEv)} to ${eV(fit.toEv)}` : '–'}</td>
                <td>{GAP_METHODS[method].short}</td>
                <td>
                  {id === selected ? (
                    <span class="badge badge-accent">In use</span>
                  ) : (
                    <button type="button" class="btn btn-quiet" onClick={() => onChoose(id)}>
                      Use<span class="visually-hidden"> {TRANSITIONS[id].label}</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UrbachSection({
  analysis,
  choice,
  data,
  update,
  onRegion,
}: PlotStepProps & { onRegion: (region: [number, number]) => void }) {
  const urbach = analysis.urbach;
  const { signal } = analysis;
  const logSignal = useMemo(() => signal.signal.map((v) => (v > 0 ? Math.log(v) : NaN)), [signal]);
  const region = urbach?.region ?? null;
  const fit = urbach?.fit ?? null;
  const sources = useMemo(
    () => [curveSource('urbach', 'ln of the absorption quantity', signal.energyEv, logSignal)],
    [signal, logSignal],
  );
  const labels = useMemo(() => urbachLabels(signal.unit), [signal.unit]);
  const markers: PlotMarker[] = region
    ? region.map((x) => ({ x, y: valueAt(signal.energyEv, logSignal, x) }))
    : [];
  const drag = (index: number, x: number) => {
    if (!region) return;
    const next: [number, number] = [region[0], region[1]];
    next[index] =
      index === 0 ? Math.min(x, region[1] - MIN_REGION) : Math.max(x, region[0] + MIN_REGION);
    onRegion([eV(next[0], 4), eV(next[1], 4)]);
  };
  return (
    <div class="urbach">
      {fit ? (
        <p>
          Urbach energy E<sub>u</sub> ={' '}
          <strong>
            {eV(fit.euEv * 1000, 1)} ±{' '}
            {Number.isFinite(fit.euSigma) ? eV(fit.euSigma * 1000, 1) : '?'} meV
          </strong>
          , from {fit.n} points between {eV(region?.[0] ?? NaN)} and {eV(region?.[1] ?? NaN)} eV (R²
          = {fit.rSquared.toFixed(4)}).
          {choice.urbach.region === null && ' The region is an automatic suggestion.'}
        </p>
      ) : (
        <p class="message is-warning">
          <strong>Check:</strong> no exponential tail could be fitted. The Urbach region is searched
          between 0.6 eV below the Tauc band gap and the gap itself, and needs positive values
          there. Make sure the Tauc fit works first, and drag the markers if a region is shown.
        </p>
      )}
      {fit && (fit.rSquared < 0.95 || fit.euSigma > 0.3 * fit.euEv) && (
        <p class="message is-warning">
          <strong>Check:</strong> the tail is not close to a straight line of ln α against energy
          (R² = {fit.rSquared.toFixed(3)}), or its slope is poorly determined, so this E<sub>u</sub>{' '}
          is unreliable. A sharp edge with no real tail, such as the synthetic example, gives a
          meaningless value. Drag the markers over a clear exponential tail.
        </p>
      )}
      {region && (
        <PlotPanel
          sources={sources}
          settings={data.plot}
          onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
          labels={() => labels}
          xName="E"
          xUnit=" eV"
          exportName="urbach"
          showOverlayOptions={false}
          interaction={{
            markers,
            onMarkerDrag: drag,
            hint: 'Drag the round markers to change the tail region.',
          }}
        />
      )}
    </div>
  );
}
