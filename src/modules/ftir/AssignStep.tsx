import { useMemo } from 'preact/hooks';
import { suggestAssignments, type GroupTable } from '../../core/ftir/assign';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { PeakLabelSet } from '../../ui/plot/peakLabels';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import { assignmentFor, peaksOf, processAll } from './analysis';
import { peaksFor, type Assignment, type FtirData } from './data';
import { curveOf, FtirPlot } from './FtirPlot';
import groups from '../../../data/ftir/groups.json';
import { useSelectedSpectrum } from './useSelected';

const table = groups as GroupTable;

/** Wizard step 4: suggested assignments for each peak, which the user accepts, edits or removes. */
export function AssignStep({ data, update }: StepContext<FtirData>) {
  const { spectrum, select } = useSelectedSpectrum(data.spectra);
  const processed = useMemo(
    () => processAll(data.spectra, data.processing),
    [data.spectra, data.processing],
  );
  const result = spectrum ? processed[data.spectra.indexOf(spectrum)] : undefined;
  const peaks = useMemo(
    () => (spectrum && result ? peaksOf(result, peaksFor(data, spectrum.id)) : []),
    [spectrum, result, data],
  );
  const stored = spectrum ? data.assignments[spectrum.id] : undefined;
  const rows = useMemo(
    () =>
      peaks.map((peak) => ({
        peak,
        label: assignmentFor(stored, peak.wavenumber),
        suggestions: suggestAssignments(peak.wavenumber, table, data.toleranceCm),
      })),
    [peaks, stored, data.toleranceCm],
  );
  const labels = useMemo<PeakLabelSet>(
    () => ({
      labels: peaks.map((p) => ({
        x: -p.wavenumber,
        y: p.height,
        text: String(Math.round(p.wavenumber)),
      })),
      key: [],
    }),
    [peaks],
  );
  const curves = useMemo(
    () => (spectrum && result ? [curveOf(spectrum.id, spectrum.name, result)] : []),
    [spectrum, result],
  );

  if (!spectrum || !result) return <p>No spectra are loaded. Go back to Upload to add one.</p>;

  const setAssignments = (next: Assignment[]) =>
    update({ assignments: { ...data.assignments, [spectrum.id]: next } });
  /** Sets (or with an empty label removes) the assignment of the peak at this wavenumber. */
  const setLabel = (wavenumber: number, label: string) => {
    const others = (stored ?? []).filter((a) => Math.abs(a.wavenumber - wavenumber) > 2);
    setAssignments(label.trim() === '' ? others : [...others, { wavenumber, label }]);
  };
  const acceptAll = () => {
    const added = rows.flatMap((r) => {
      const best = r.suggestions[0];
      return r.label || !best ? [] : [{ wavenumber: r.peak.wavenumber, label: best.label }];
    });
    setAssignments([...(stored ?? []), ...added]);
  };

  return (
    <div class="clean-step">
      {data.spectra.length > 1 && (
        <div class="clean-toolbar">
          <label class="inline-field">
            Spectrum
            <select value={spectrum.id} onChange={(e) => select(e.currentTarget.value)}>
              {data.spectra.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <p class="message">
        <strong>Typical ranges, confirm against your literature.</strong> The suggestions below are
        estimates from where each peak lies. Many groups absorb in the same place, so a peak
        position alone cannot prove which group is present. Nothing is assigned until you accept it.
      </p>

      <section class="process-step is-on" aria-labelledby="assign-title">
        <h3 id="assign-title" class="process-step-title">
          Suggested assignments{' '}
          <HelpTip term="assignment suggestions">
            <p>
              Each peak is compared with typical wavenumber ranges of bond vibrations and with band
              positions listed for metal oxides. A group is suggested when the peak is inside its
              range or within the distance below of it. Closer matches come first. Use "Accept" to
              keep a suggestion, edit the text to describe it in your own words, or clear the box.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <NumberInput
            label="Suggest within (cm⁻¹ of a range)"
            value={data.toleranceCm}
            min={0}
            max={100}
            onChange={(v) => v !== null && update({ toleranceCm: v })}
          />
          <button type="button" class="btn" onClick={acceptAll} disabled={rows.length === 0}>
            Accept the best suggestion for every peak without an assignment
          </button>
        </div>
        <p class="field-hint">
          The distance is my own default (15 cm⁻¹), not a published value; change it as you see fit.
        </p>
      </section>

      <FtirPlot
        curves={curves}
        quantity="absorbance"
        settings={data.plot}
        onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
        exportName={`${spectrum.name}-assigned`}
        showOverlayOptions={false}
        peakLabels={labels}
      />

      {rows.length === 0 ? (
        <p class="message is-warning">
          <strong>Check:</strong> there are no peaks to assign. Go back to step 3 and lower the
          minimum prominence.
        </p>
      ) : (
        <ul class="assign-list">
          {[...rows].reverse().map(({ peak, label, suggestions }) => {
            const id = `assign-${Math.round(peak.wavenumber * 10)}`;
            return (
              <li key={peak.wavenumber} class="assign-row">
                <h4 class="assign-peak">
                  {formatNumber(peak.wavenumber, 1)} cm⁻¹{' '}
                  <span class="field-hint">
                    absorbance {formatNumber(peak.height, 3)}, {formatNumber(peak.relative, 0)} % of
                    the highest
                  </span>
                </h4>
                <div class="inline-field">
                  <label for={id}>Your assignment</label>
                  <input
                    id={id}
                    type="text"
                    value={label}
                    placeholder="none yet"
                    onChange={(e) => setLabel(peak.wavenumber, e.currentTarget.value)}
                  />
                  {label !== '' && (
                    <button
                      type="button"
                      class="btn btn-quiet"
                      onClick={() => setLabel(peak.wavenumber, '')}
                    >
                      Remove
                      <span class="visually-hidden">
                        {' '}
                        assignment at {formatNumber(peak.wavenumber, 1)}
                      </span>
                    </button>
                  )}
                </div>
                {suggestions.length === 0 ? (
                  <p class="field-hint">
                    Nothing in the table lies within {data.toleranceCm} cm⁻¹ of this peak.
                  </p>
                ) : (
                  <ul class="suggestion-list">
                    {suggestions.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          class="btn"
                          onClick={() => setLabel(peak.wavenumber, s.label)}
                          disabled={label === s.label}
                        >
                          Accept<span class="visually-hidden"> {s.label}</span>
                        </button>{' '}
                        <strong>{s.label}</strong>
                        <span class="field-hint"> {s.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <details class="paste-box">
        <summary>The reference table used</summary>
        <p class="field-hint">
          Source: {table.source.citation}, doi:{table.source.doi} ({table.source.licence}),
          retrieved {table.source.retrieved}. {table.verification}
        </p>
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Reference table, scrolls sideways"
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">Range or band (cm⁻¹)</th>
                <th scope="col">Assignment</th>
              </tr>
            </thead>
            <tbody>
              {table.functionalGroups.map((g) => (
                <tr key={g.id}>
                  <td>
                    {g.approximate ? '~' : ''}
                    {g.ranges
                      .map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`))
                      .join(', ')}
                  </td>
                  <th scope="row">{g.label}</th>
                </tr>
              ))}
              {table.metalOxides.map((m) => (
                <tr key={m.id}>
                  <td>{m.bands.map((b) => b.cm).join(', ')}</td>
                  <th scope="row">{m.label} (bands)</th>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
