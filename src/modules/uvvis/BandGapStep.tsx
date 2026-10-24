import { useMemo, useState } from 'preact/hooks';
import { energyFromWavelength } from '../../core/uvvis/conversions';
import { TRANSITIONS, type TransitionId } from '../../core/uvvis/tauc';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { PlotMarker } from '../../ui/plot/types';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import { analyseBandGap, cleanAll, fitMessages, type BandGapAnalysis } from './analysis';
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
        ? analyseBandGap(spectrum, cleanedSpectrum, choice)
        : null,
    [spectrum, cleanedSpectrum, choice],
  );

  if (!spectrum || !analysis || !choice) {
    return <p>No spectra are loaded. Go back to Upload to add one.</p>;
  }

  const change = (patch: Partial<BandGapChoice>) =>
    update({ bandGap: { ...data.bandGap, [spectrum.id]: { ...choice, ...patch } } });
  const setRegion = (region: [number, number] | null) => {
    const regions = Object.fromEntries(
      Object.entries(choice.regions).filter(([id]) => id !== choice.transition),
    );
    change({ regions: region ? { ...regions, [choice.transition]: region } : regions });
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
              band gap is where that line meets the energy axis. The exponent n depends on the type
              of electronic transition: 1/2 for direct allowed, 2 for indirect allowed, 3/2 for
              direct forbidden and 3 for indirect forbidden. Which one fits your material should
              come from the literature, not from which line looks straightest.
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
        <TaucResult analysis={analysis} onReset={() => setRegion(null)} />
      </section>

      <TaucPlot
        analysis={analysis}
        choice={choice}
        data={data}
        update={update}
        onRegion={setRegion}
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
          The ± is the statistical uncertainty of the straight-line fit only. It is smaller than the
          true uncertainty, which also depends on the region you choose.
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
  name,
}: PlotStepProps & { onRegion: (region: [number, number]) => void; name: string }) {
  const { fit, signal, region, tauc } = analysis;
  const sources = useMemo(() => {
    const list: SeriesSource[] = [curveSource('tauc', 'Tauc curve', signal.energyEv, tauc)];
    if (fit) {
      const end = fit.toEv + 0.1;
      list.push({
        id: 'fit',
        name: `Linear fit, Eg = ${eV(fit.egEv)} eV`,
        x: Float64Array.from([fit.egEv, end]),
        y: Float64Array.from([0, fit.slope * (end - fit.egEv)]),
        unit: '',
        colorIndex: 1,
        dashed: true,
      });
    }
    return list;
  }, [signal, tauc, fit]);
  const labels = useMemo(
    () => taucLabels(choice.transition, signal.unit),
    [choice.transition, signal.unit],
  );
  const markers: PlotMarker[] = region
    ? region.map((x) => ({ x, y: valueAt(signal.energyEv, tauc, x) }))
    : [];
  const drag = (index: number, x: number) => {
    if (!region) return;
    const next: [number, number] = [region[0], region[1]];
    next[index] =
      index === 0 ? Math.min(x, region[1] - MIN_REGION) : Math.max(x, region[0] + MIN_REGION);
    onRegion([eV(next[0], 4), eV(next[1], 4)]);
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
        hint: 'Drag the round markers to change the fit region. Pinch or Ctrl and scroll to zoom.',
      }}
    />
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
            Each type is fitted over its own suggested region, so the numbers are not directly
            comparable in quality. A higher R² does not prove which transition a material has;
            several can look almost equally straight.
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
              <th scope="col">Use</th>
            </tr>
          </thead>
          <tbody>
            {analysis.comparison.map(({ id, fit }) => (
              <tr key={id}>
                <th scope="row">{TRANSITIONS[id].label}</th>
                <td>{TRANSITIONS[id].nText}</td>
                <td>{fit ? gapText(fit) : '–'}</td>
                <td>{fit ? fit.rSquared.toFixed(4) : '–'}</td>
                <td>{fit ? `${eV(fit.fromEv)} to ${eV(fit.toEv)}` : '–'}</td>
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
