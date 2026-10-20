import { useMemo, useState } from 'preact/hooks';
import {
  correctPeaks,
  RESOLUTION_LIMIT_RATIO,
  type CorrectedPeak,
  type CorrectionMethod,
} from '../../core/xrd/instrument/correction';
import { instrumentWidth } from '../../core/xrd/instrument/curve';
import { toCsv, type CsvColumn } from '../../core/xrd/peaks/table';
import { formatWithSigma } from '../../ui/format';
import { HelpTip } from '../../ui/HelpTip';
import { downloadBlob, fileStem } from '../../ui/plot/export';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { AxisLabels } from '../../ui/plot/types';
import type { StepContext } from '../../ui/wizard/types';
import {
  fitInputKey,
  peaksFor,
  processingFor,
  type InstrumentSource,
  type InstrumentState,
  type XrdData,
} from './data';
import { instrumentModel, type InstrumentModel } from './instrument';
import { CURVE_LABELS, StandardPanel } from './StandardPanel';

const SOURCE_LABELS: Record<InstrumentSource, string> = {
  constant: 'Type a constant instrument FWHM',
  caglioti: 'Type Caglioti parameters U, V, W',
  standard: 'Measure it from a standard pattern (LaB₆ or Si)',
  skip: 'Skip the correction',
};

const METHODS: { id: CorrectionMethod; label: string; text: string }[] = [
  {
    id: 'gaussian',
    label: 'Gaussian (subtract squares)',
    text: 'β = √(B² − b²). Right when both the sample and the instrument peaks are close to Gaussian (fitted η near 0). This is the default and the most common choice.',
  },
  {
    id: 'lorentzian',
    label: 'Lorentzian (subtract linearly)',
    text: 'β = B − b. Right when both peaks are close to Lorentzian (fitted η near 1). It removes more width than the Gaussian rule, so it gives larger sizes.',
  },
  {
    id: 'voigt',
    label: 'Approximate Voigt',
    text: 'Uses each fitted η to split both widths into a Gaussian and a Lorentzian part, corrects each part by its own rule and joins them again. Best when η is in between; fit with pseudo-Voigt for it to make sense.',
  },
];

/** Wizard step 6: remove the instrument's contribution from the fitted peak widths. */
export function InstrumentStep({ data, update }: StepContext<XrdData>) {
  const instrument = data.instrument;
  const setInstrument = (patch: Partial<InstrumentState>) =>
    update({ instrument: { ...instrument, ...patch } });
  const result = instrumentModel(instrument);
  const model = 'model' in result ? result.model : null;

  return (
    <div class="fit-step">
      <p class="message is-info">
        <strong>Why this matters:</strong> every diffractometer makes peaks a little wider than the
        sample alone would. Size methods such as Scherrer read extra width as smaller crystals, so
        skipping this correction makes crystallite sizes come out smaller than reality.
      </p>

      <section class="process-step is-on" aria-labelledby="source-title">
        <h3 id="source-title" class="process-step-title">
          Instrument contribution{' '}
          <HelpTip term="instrumental broadening">
            <p>
              The width your instrument gives to a peak from a perfect, strain-free crystal. It
              depends on the slits, optics, wavelength spread and angle. FWHM is the full width at
              half the peak height, in degrees 2θ.
            </p>
          </HelpTip>
        </h3>
        <div class="process-step-body">
          <fieldset class="method-choice method-stack">
            <legend>Where the instrument width comes from</legend>
            {(Object.keys(SOURCE_LABELS) as InstrumentSource[]).map((s) => (
              <label key={s} class="check">
                <input
                  type="radio"
                  name="instrument-source"
                  checked={instrument.source === s}
                  onChange={() => setInstrument({ source: s })}
                />
                {SOURCE_LABELS[s]}
              </label>
            ))}
          </fieldset>
          {instrument.source === 'constant' && (
            <NumberField
              label="Instrument FWHM (° 2θ)"
              value={instrument.constantFwhm}
              min={0}
              onChange={(constantFwhm) => setInstrument({ constantFwhm })}
            />
          )}
          {instrument.source === 'caglioti' && (
            <CagliotiFields instrument={instrument} setInstrument={setInstrument} />
          )}
          {instrument.source === 'standard' && (
            <StandardPanel data={data} update={update} setInstrument={setInstrument} />
          )}
          {instrument.source === 'skip' && (
            <p class="message is-warning">
              <strong>Check:</strong> no instrument correction. The widths stay as fitted, so every
              crystallite size will come out smaller than reality. This warning stays with your
              results.
            </p>
          )}
          {'problem' in result && <p class="field-hint">{result.problem}</p>}
        </div>
      </section>

      {instrument.source !== 'skip' && (
        <section class="process-step is-on" aria-labelledby="method-title">
          <h3 id="method-title" class="process-step-title">
            Correction method
          </h3>
          <div class="process-step-body">
            <fieldset class="method-choice method-stack">
              <legend>
                B is the observed width, b the instrument width and β the sample width.
              </legend>
              {METHODS.map((m) => (
                <label key={m.id} class="check method-option">
                  <input
                    type="radio"
                    name="correction-method"
                    checked={instrument.method === m.id}
                    onChange={() => setInstrument({ method: m.id })}
                  />
                  <span>
                    <strong>{m.label}</strong>
                    <span class="method-text">{m.text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {instrument.method === 'voigt' && instrument.source !== 'standard' && (
              <NumberField
                label="Instrument η (0 = Gaussian, 1 = Lorentzian)"
                value={instrument.eta}
                min={0}
                max={1}
                step={0.05}
                onChange={(eta) => setInstrument({ eta: eta ?? 0 })}
                hint="Typed widths do not say what shape the instrument peaks have. Caglioti's formula describes Gaussian peaks, so 0 is the default; use your standard's fitted η if you know it."
              />
            )}
            {instrument.method === 'voigt' && model && instrument.source === 'standard' && (
              <p class="field-hint">
                Instrument η from the standard fit: {model.instrumentEta(0).toFixed(2)}.
              </p>
            )}
          </div>
        </section>
      )}

      {model && <CurveView data={data} update={update} model={model} />}
      {model && <CorrectionTable data={data} model={model} />}
    </div>
  );
}

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

function NumberField({ label, value, onChange, min, max, step, hint }: NumberFieldProps) {
  return (
    <label class="inline-field">
      {label}
      <input
        type="number"
        inputMode="decimal"
        step={step ?? 'any'}
        {...(min !== undefined && { min })}
        {...(max !== undefined && { max })}
        value={value ?? ''}
        onChange={(e) => {
          const text = e.currentTarget.value.trim();
          const v = Number(text);
          if (text === '') onChange(null);
          else if (
            Number.isFinite(v) &&
            (min === undefined || v >= min) &&
            (max === undefined || v <= max)
          )
            onChange(v);
        }}
      />
      {hint && <span class="field-hint">{hint}</span>}
    </label>
  );
}

function CagliotiFields({
  instrument,
  setInstrument,
}: {
  instrument: InstrumentState;
  setInstrument: (patch: Partial<InstrumentState>) => void;
}) {
  const c = instrument.caglioti;
  const set = (patch: Partial<typeof c>) => setInstrument({ caglioti: { ...c, ...patch } });
  const unit = c.convention === 'fwhm' ? 'deg²' : 'centideg²';
  return (
    <>
      <fieldset class="method-choice">
        <legend>
          Convention{' '}
          <HelpTip term="the Caglioti convention">
            <p>
              Caglioti: FWHM² = U tan²θ + V tanθ + W, with FWHM in degrees 2θ, so U, V and W are in
              deg². GSAS-II instead reports the Gaussian variance σ² = U tan²θ + V tanθ + W in
              centidegrees² (0.01°)²; the app converts it with FWHM = √(8 ln 2) σ. Check which one
              your software uses.
            </p>
          </HelpTip>
        </legend>
        <label class="check">
          <input
            type="radio"
            name="caglioti-convention"
            checked={c.convention === 'fwhm'}
            onChange={() => set({ convention: 'fwhm' })}
          />
          FWHM² in deg² (Caglioti)
        </label>
        <label class="check">
          <input
            type="radio"
            name="caglioti-convention"
            checked={c.convention === 'gsas'}
            onChange={() => set({ convention: 'gsas' })}
          />
          σ² in centideg² (GSAS-II)
        </label>
      </fieldset>
      <div class="radiation-fields">
        <NumberField label={`U (${unit})`} value={c.u} onChange={(u) => set({ u })} />
        <NumberField label={`V (${unit})`} value={c.v} onChange={(v) => set({ v })} />
        <NumberField label={`W (${unit})`} value={c.w} onChange={(w) => set({ w })} />
      </div>
    </>
  );
}

const CURVE_AXES: AxisLabels = {
  x: (
    <>
      2<tspan font-style="italic">θ</tspan> (°)
    </>
  ),
  y: 'Instrument FWHM (°)',
  yValues: true,
};

/** The instrument FWHM against 2θ, with the standard's peaks as points when there are any. */
function CurveView({ data, update, model }: StepContext<XrdData> & { model: InstrumentModel }) {
  const used = model.points?.filter((p) => p.included) ?? [];
  const sampleX = data.patterns.flatMap((p) =>
    p.twoTheta.length > 0
      ? [p.twoTheta[0] as number, p.twoTheta[p.twoTheta.length - 1] as number]
      : [],
  );
  const lo = Math.min(...sampleX, ...used.map((p) => p.twoTheta));
  const hi = Math.max(...sampleX, ...used.map((p) => p.twoTheta));
  const sources = useMemo(() => {
    const n = 300;
    const x = Float64Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
    const y = x.map((v) => instrumentWidth(model.curve, v).fwhm);
    return [{ id: 'curve', name: 'Instrument curve', x, y, unit: '°', colorIndex: 0 }];
  }, [model.curve, lo, hi]);
  if (!(hi > lo)) return null;
  const standard = data.instrument.standard;
  return (
    <section class="region-summary" aria-labelledby="curve-title">
      <h3 id="curve-title" class="export-title">
        Instrument width against 2θ
      </h3>
      {model.fit && standard && (
        <p class="field-hint">
          {CURVE_LABELS[standard.curve]} through {used.length} standard peaks (points). RMS
          difference {model.fit.rms.toFixed(4)}°.
          {model.curve.kind === 'caglioti' &&
            ` U = ${model.curve.u.toPrecision(4)}, V = ${model.curve.v.toPrecision(4)}, W = ${model.curve.w.toPrecision(4)} deg².`}
        </p>
      )}
      {model.fit?.messages.map((m, i) => (
        <p key={i} class={`message is-${m.level}`}>
          {m.text}
        </p>
      ))}
      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
        labels={() => CURVE_AXES}
        xName="2θ"
        xUnit="°"
        exportName="instrument-fwhm"
        showOverlayOptions={false}
        points={used.map((p) => ({ x: p.twoTheta, y: p.fwhm }))}
      />
    </section>
  );
}

const METHOD_NAMES: Record<CorrectionMethod, string> = {
  gaussian: 'Gaussian (β² = B² − b²)',
  lorentzian: 'Lorentzian (β = B − b)',
  voigt: 'approximate Voigt (Thompson–Cox–Hastings split)',
};

/** Before and after FWHM for every fitted peak of one pattern, with CSV export. */
function CorrectionTable({ data, model }: { data: XrdData; model: InstrumentModel }) {
  const patterns = data.patterns;
  const [selectedId, setSelectedId] = useState(patterns[0]?.id);
  const pattern = patterns.find((p) => p.id === selectedId) ?? patterns[0];
  if (!pattern) return null;
  const state = peaksFor(data, pattern.id);
  const fit = state.fit;
  const method = data.instrument.method;
  const rows: CorrectedPeak[] = fit
    ? correctPeaks(
        fit.regions.flatMap((r) =>
          r.peaks.map((p) => ({
            twoTheta: p.center,
            fwhm: p.fwhm,
            fwhmSigma: p.sigma.fwhm,
            eta: p.eta,
          })),
        ),
        { ...model, method },
      ).sort((a, b) => a.twoTheta - b.twoTheta)
    : [];
  const stale =
    fit !== null &&
    fit.inputKey !==
      fitInputKey(state.guesses, state.fitOptions, processingFor(data, pattern.id), data.radiation);
  const standard = data.instrument.standard;
  const kAlpha2Mismatch =
    data.instrument.source === 'standard' &&
    standard !== null &&
    standard.processing.kAlpha2.enabled !== processingFor(data, pattern.id).kAlpha2.enabled;
  const profileMismatch =
    data.instrument.source === 'standard' &&
    standard !== null &&
    standard.peaks.fitOptions.profile !== state.fitOptions.profile;

  const exportCsv = () => {
    const columns: CsvColumn<CorrectedPeak>[] = [
      { header: '2θ (°)', value: (r) => r.twoTheta },
      { header: 'Observed FWHM B (°)', value: (r) => r.observed },
      { header: 'σ B (°)', value: (r) => r.observedSigma },
      { header: 'Instrument FWHM b (°)', value: (r) => r.instrument },
      { header: 'σ b (°)', value: (r) => r.instrumentSigma },
      { header: 'Corrected FWHM β (°)', value: (r) => r.corrected },
      { header: 'σ β (°)', value: (r) => r.correctedSigma },
      { header: 'b/B', value: (r) => r.ratio },
      { header: 'Limited by resolution', value: (r) => (r.limited ? 'yes' : 'no') },
      { header: 'Notes', value: (r) => r.messages.map((m) => m.text).join(' ') },
    ];
    const curve = model.curve;
    const curveText =
      curve.kind === 'constant'
        ? `constant b = ${curve.fwhm}°`
        : curve.kind === 'caglioti'
          ? `Caglioti FWHM² = U tan²θ + V tanθ + W with U = ${curve.u}, V = ${curve.v}, W = ${curve.w} deg²`
          : `polynomial in (2θ − ${curve.pivot}°) with coefficients ${curve.coefficients.join(', ')}`;
    const from =
      data.instrument.source === 'standard' && standard
        ? ` fitted to ${standard.material} standard "${standard.pattern.name}"`
        : ' (typed in)';
    const header = `# Instrument correction for ${pattern.name}. Method: ${METHOD_NAMES[method]}. Instrument width: ${curveText}${from}. Widths in degrees 2θ. σ = standard uncertainty.\r\n`;
    downloadBlob(
      new Blob([header + toCsv(rows, columns)], { type: 'text/csv' }),
      `${fileStem(pattern.name)}-instrument-correction.csv`,
    );
  };

  return (
    <section class="peak-table-section" aria-labelledby="correction-title">
      <div class="peak-table-header">
        <h3 id="correction-title" class="export-title">
          FWHM before and after correction
        </h3>
        {rows.length > 0 && (
          <button type="button" class="btn" onClick={exportCsv}>
            Download CSV
          </button>
        )}
      </div>
      {patterns.length > 1 && (
        <label class="inline-field">
          Pattern
          <select value={pattern.id} onChange={(e) => setSelectedId(e.currentTarget.value)}>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!fit && (
        <p class="field-hint">
          This pattern has no fitted peaks yet. Fit them in step 5, Fit peaks.
        </p>
      )}
      {stale && (
        <p class="message is-warning">
          <strong>Check:</strong> the peak fit for this pattern is out of date. Fit again in step 5
          so these widths match your current settings.
        </p>
      )}
      {kAlpha2Mismatch && (
        <p class="message is-warning">
          <strong>Check:</strong> Kα2 was stripped from{' '}
          {standard.processing.kAlpha2.enabled
            ? 'the standard but not the sample'
            : 'the sample but not the standard'}
          . Treat both the same way, or the widths cannot be compared.
        </p>
      )}
      {profileMismatch && (
        <p class="message is-warning">
          <strong>Check:</strong> the standard and the sample were fitted with different peak
          shapes, so their widths are not measured the same way.
        </p>
      )}
      {rows.length > 0 && (
        <>
          <p class="field-hint">
            Method: {METHOD_NAMES[method]}. Peaks are marked when the corrected width is zero or the
            instrument makes up {Math.round(100 * RESOLUTION_LIMIT_RATIO)} % or more of the observed
            width.
          </p>
          <div
            class="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Correction table, scrolls sideways"
          >
            <table class="peak-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">2θ (°)</th>
                  <th scope="col">Observed B (°)</th>
                  <th scope="col">Instrument b (°)</th>
                  <th scope="col">Corrected β (°)</th>
                  <th scope="col">b/B (%)</th>
                  <th scope="col">Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} class={r.limited ? 'is-limited' : undefined}>
                    <td>{i + 1}</td>
                    <td>{r.twoTheta.toFixed(3)}</td>
                    <td>{formatWithSigma(r.observed, r.observedSigma)}</td>
                    <td>{formatWithSigma(r.instrument, r.instrumentSigma)}</td>
                    <td>{formatWithSigma(r.corrected, r.correctedSigma)}</td>
                    <td>{Number.isFinite(r.ratio) ? (100 * r.ratio).toFixed(0) : '–'}</td>
                    <td class="peak-notes">{r.messages.map((m) => m.text).join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
