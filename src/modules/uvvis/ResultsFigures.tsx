import { useMemo } from 'preact/hooks';
import { TRANSITIONS, type SignalUnit, type TransitionId } from '../../core/uvvis/tauc';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { PlotMarker } from '../../ui/plot/types';
import type { StepContext } from '../../ui/wizard/types';
import { cleanAll, spectrumJob } from './analysis';
import type { BandGapAnalysis } from './bandGap';
import { useBandGaps } from './bandGapClient';
import { bandLabels, bandRows } from './bands';
import { bandGapFor, type UvvisData } from './data';
import { taucLabels } from './labels';
import { powerBaselineText } from './tables';
import { UvvisPlot } from './UvvisPlot';
import { quantityFor, shownCurves } from './view';

/** The two combined figures of Results: every spectrum, and the Tauc plots of chosen spectra. */
export function ResultsFigures({ data, update }: StepContext<UvvisData>) {
  return (
    <>
      <SpectraFigure data={data} update={update} />
      <TaucFigure data={data} update={update} />
    </>
  );
}

function SpectraFigure({ data, update }: Pick<StepContext<UvvisData>, 'data' | 'update'>) {
  const { spectra, cleaning, figures } = data;
  // Spectrum figures are drawn against wavelength (owner's choice); the quantity follows step 2.
  const view = useMemo(() => ({ ...data.view, xUnit: 'nm' as const }), [data.view]);
  const shown = useMemo(() => {
    const cleaned = cleanAll(spectra, cleaning);
    return shownCurves(
      spectra.flatMap((spectrum, i) => {
        const c = cleaned[i];
        return c
          ? [
              {
                spectrum,
                id: spectrum.id,
                name: spectrum.name,
                wavelengthNm: c.wavelengthNm,
                values: c.values,
              },
            ]
          : [];
      }),
      view,
    );
  }, [spectra, cleaning, view]);
  const labels = useMemo(() => {
    if (!figures.peakLabels) return undefined;
    // Bands are found on A or F(R); their labels are drawn only on curves shown as that quantity.
    const rows = bandRows(data).filter((r) => quantityFor(r.spectrum, view) === r.quantity);
    return bandLabels(rows, (id) => id);
    // The band table depends on the spectra, cleaning and band settings only.
  }, [figures.peakLabels, spectra, cleaning, data.peaks, data.peakEdits, view]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section aria-labelledby="spectra-figure-title">
      <h4 id="spectra-figure-title" class="export-title">
        All spectra
      </h4>
      <label class="check">
        <input
          type="checkbox"
          checked={figures.peakLabels}
          onChange={(e) => update({ figures: { ...figures, peakLabels: e.currentTarget.checked } })}
        />
        Label the bands of the band table (step 3)
      </label>
      {shown.excluded.length > 0 && (
        <p class="field-hint">
          Not drawn, because they cannot be shown as the quantity chosen in step 2:{' '}
          {shown.excluded.join(', ')}.
        </p>
      )}
      {figures.peakLabels && data.view.quantity !== 'measured' && (
        <p class="field-hint">
          Band labels are drawn only on spectra shown as absorbance (or F(R) for reflectance), the
          quantity the bands were found on.
        </p>
      )}
      <UvvisPlot
        curves={shown.curves}
        view={view}
        quantity={shown.quantity}
        settings={data.plot}
        onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
        exportName="uvvis-spectra"
        {...(labels && { peakLabels: labels })}
      />
    </section>
  );
}

interface TaucItem {
  id: string;
  name: string;
  analysis: BandGapAnalysis;
}

function TaucFigure({ data, update }: Pick<StepContext<UvvisData>, 'data' | 'update'>) {
  const { spectra, figures } = data;
  const first = spectra[0];
  const transition: TransitionId =
    figures.taucTransition ?? (first ? bandGapFor(data, first.id).transition : 'direct-allowed');
  const wanted = useMemo(() => {
    const cleaned = cleanAll(data.spectra, data.cleaning);
    return data.spectra.flatMap((s, i) => {
      const job = spectrumJob(data, cleaned, i, { ...bandGapFor(data, s.id), transition });
      return job ? [{ id: s.id, name: s.name, job }] : [];
    });
  }, [data, transition]);
  const jobs = useMemo(() => wanted.map((w) => w.job), [wanted]);
  // The last figure of the same spectra stays while another transition is analysed.
  const gaps = useBandGaps(jobs, wanted.map((w) => w.id).join('\u0000'));
  const analyses = gaps.analyses ?? gaps.previous;
  const items = useMemo<TaucItem[]>(
    () =>
      analyses
        ? wanted.map((w, i) => ({
            id: w.id,
            name: w.name,
            analysis: analyses[i] as BandGapAnalysis,
          }))
        : [],
    [wanted, analyses],
  );
  const fitted = items.filter((it) => it.analysis.fit);
  const chosen = figures.taucIds
    ? fitted.filter((it) => (figures.taucIds as string[]).includes(it.id))
    : fitted;
  const units = [...new Set(chosen.map((it) => it.analysis.signal.unit))];
  const unit: SignalUnit = units.length === 1 ? (units[0] as SignalUnit) : 'proportional';

  const { sources, points } = useMemo(() => {
    const list: SeriesSource[] = [];
    const marks: PlotMarker[] = [];
    chosen.forEach((it, k) => {
      const a = it.analysis;
      const fit = a.fit;
      if (!fit) return;
      const curve =
        a.method === 'subtract-baseline'
          ? (a.taucCorrected ?? a.tauc)
          : a.method === 'subtract-component'
            ? (a.taucComponent ?? a.tauc)
            : a.tauc;
      const keep: number[] = [];
      for (let i = 0; i < curve.length; i++) if (Number.isFinite(curve[i])) keep.push(i);
      list.push({
        id: it.id,
        name: it.name,
        x: Float64Array.from(keep, (i) => a.signal.energyEv[i] as number),
        y: Float64Array.from(keep, (i) => curve[i] as number),
        unit: '',
        colorIndex: k,
      });
      const end = fit.toEv + 0.1;
      const line = (e: number) => fit.intercept + fit.slope * e;
      const atGap = a.method === 'baseline-crossing' ? line(fit.egEv) : 0;
      list.push({
        id: `${it.id}-fit`,
        name: `${it.name} fit, Eg = ${fit.egEv.toFixed(3)} eV${a.powerBaseline ? ` (${powerBaselineText(a)})` : ''}`,
        x: Float64Array.from([fit.egEv, end]),
        y: Float64Array.from([atGap, atGap + line(end) - line(fit.egEv)]),
        unit: '',
        colorIndex: k,
        dashed: true,
      });
      marks.push({ x: fit.egEv, y: atGap });
    });
    return { sources: list, points: marks };
  }, [chosen]);
  const labels = useMemo(() => taucLabels(transition, unit), [transition, unit]);
  const toggle = (id: string, on: boolean) => {
    const current = figures.taucIds ?? fitted.map((it) => it.id);
    update({
      figures: {
        ...figures,
        taucIds: on ? [...current.filter((x) => x !== id), id] : current.filter((x) => x !== id),
      },
    });
  };

  return (
    <section aria-labelledby="tauc-figure-title">
      <h4 id="tauc-figure-title" class="export-title">
        Tauc plots together
      </h4>
      <div class="radiation-fields">
        <label class="inline-field">
          Transition
          <select
            value={transition}
            onChange={(e) =>
              update({
                figures: { ...figures, taucTransition: e.currentTarget.value as TransitionId },
              })
            }
          >
            {(Object.keys(TRANSITIONS) as TransitionId[]).map((id) => (
              <option key={id} value={id}>
                {TRANSITIONS[id].label} (n = {TRANSITIONS[id].nText})
              </option>
            ))}
          </select>
        </label>
      </div>
      <p class="field-hint" role="status">
        {gaps.error
          ? `The band gaps could not be found: ${gaps.error}`
          : gaps.analyses
            ? ''
            : 'Finding the band gaps for this transition…'}
      </p>
      <fieldset class="radiation-fields">
        <legend>Spectra in the figure</legend>
        {items.map((it) => (
          <label key={it.id} class="check">
            <input
              type="checkbox"
              disabled={!it.analysis.fit}
              checked={chosen.some((c) => c.id === it.id)}
              onChange={(e) => toggle(it.id, e.currentTarget.checked)}
            />
            {it.name}
            {it.analysis.fit ? '' : ' (no fit for this transition)'}
          </label>
        ))}
      </fieldset>
      <p class="field-hint">
        Each spectrum is fitted over its own region for this transition (set in step 4), and the dot
        marks its Eg. Where Eg is read with a baseline subtracted, the corrected curve is drawn.
      </p>
      {units.length > 1 && (
        <p class="message is-warning">
          <strong>Check:</strong> the chosen spectra use different absorption quantities (α, A or
          F(R)), so their vertical scales are not comparable. The axis is labelled in arbitrary
          units; compare only the band gaps.
        </p>
      )}
      {chosen.length > 0 ? (
        <PlotPanel
          sources={sources}
          settings={data.taucPlot}
          onSettingsChange={(plot) => update({ taucPlot: { ...data.taucPlot, ...plot } })}
          labels={() => labels}
          xName="E"
          xUnit=" eV"
          exportName="uvvis-tauc-combined"
          showOverlayOptions={false}
          points={points}
          dock="manual"
        />
      ) : (
        <p class="field-hint">No spectrum with a fit for this transition is chosen.</p>
      )}
    </section>
  );
}
