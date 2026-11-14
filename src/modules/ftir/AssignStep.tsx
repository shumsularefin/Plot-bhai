import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  suggestAssignments,
  type AtmosphereTable,
  type GroupTable,
  type Suggestion,
} from '../../core/ftir/assign';
import type { FtirPeak } from '../../core/ftir/peaks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import {
  ASSIGNMENT_MATCH_CM,
  attachAssignments,
  MOVED_NOTE_CM,
  peaksOf,
  processAll,
} from './analysis';
import { newId, peaksFor, type Assignment, type FtirData } from './data';
import { curveOf, FtirPlot, peakLabelsFor } from './FtirPlot';
import { QuantityChoice } from './QuantityChoice';
import { shownQuantity, valueIn, type FtirQuantity } from './quantity';
import atmosphereBands from '../../../data/ftir/atmosphere.json';
import groups from '../../../data/ftir/groups.json';
import { useSelectedSpectrum } from './useSelected';

const table = groups as GroupTable;
const atmosphere = atmosphereBands as AtmosphereTable;

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
  const attached = useMemo(() => attachAssignments(stored, peaks), [stored, peaks]);
  const rows = useMemo(
    () =>
      peaks.map((peak, i): PeakRow => {
        const assignment = attached.byPeak[i];
        return {
          peak,
          assignment,
          label: assignment?.label ?? '',
          suggestions: suggestAssignments(peak.wavenumber, table, data.toleranceCm, 6, atmosphere),
        };
      }),
    [peaks, attached, data.toleranceCm],
  );
  // Highest wavenumber first, the way an FTIR spectrum is read.
  const ordered = useMemo(() => [...rows].reverse(), [rows]);
  const [current, setCurrent] = useState(0);
  const index = Math.min(current, Math.max(0, ordered.length - 1));
  const row = ordered[index];
  const assigned = ordered.filter((r) => r.label).length;
  const shown = shownQuantity(data, spectrum ? [spectrum] : []);
  const quantity = shown.quantity;
  const labels = useMemo(() => peakLabelsFor(peaks, quantity), [peaks, quantity]);
  const curves = useMemo(
    () => (spectrum && result ? [curveOf(spectrum.id, spectrum.name, result)] : []),
    [spectrum, result],
  );

  if (!spectrum || !result) return <p>No spectra are loaded. Go back to Upload to add one.</p>;

  const setAssignments = (next: Assignment[]) =>
    update({ assignments: { ...data.assignments, [spectrum.id]: next } });
  const remove = (id: string) => setAssignments((stored ?? []).filter((a) => a.id !== id));
  /**
   * Sets (or with an empty label removes) the assignment of a peak. Editing keeps the position
   * the assignment was made at, so it re-attaches the same way after later reprocessing.
   */
  const setLabel = (row: PeakRow, label: string) => {
    const current = row.assignment;
    if (label.trim() === '') {
      if (current) remove(current.id);
      return;
    }
    setAssignments(
      current
        ? (stored ?? []).map((a) => (a.id === current.id ? { ...a, label } : a))
        : [...(stored ?? []), { id: newId(), wavenumber: row.peak.wavenumber, label }],
    );
  };
  const acceptAll = () => {
    const added = rows.flatMap((r) => {
      const best = r.suggestions[0];
      return r.assignment || !best
        ? []
        : [{ id: newId(), wavenumber: r.peak.wavenumber, label: best.label }];
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

      <QuantityChoice data={data} update={update} shown={shown} />
      <FtirPlot
        curves={curves}
        quantity={quantity}
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
        <>
          <nav class="assign-pager" aria-label="Peaks">
            <ul class="chip-row">
              {ordered.map((r, i) => (
                <li key={r.peak.wavenumber}>
                  <button
                    type="button"
                    class={`chip${r.label ? ' is-assigned' : ''}`}
                    aria-current={i === index ? 'true' : undefined}
                    onClick={() => setCurrent(i)}
                  >
                    {formatNumber(r.peak.wavenumber, 0)}
                    <span class="visually-hidden">
                      {' '}
                      cm⁻¹, {r.label ? 'assigned' : 'not assigned'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p class="field-hint" aria-live="polite">
              Peak {index + 1} of {ordered.length}, {assigned} assigned. A filled chip has an
              assignment.
            </p>
          </nav>
          {row && (
            <PeakCard
              key={row.peak.wavenumber}
              row={row}
              quantity={quantity}
              toleranceCm={data.toleranceCm}
              setLabel={setLabel}
            />
          )}
          <div class="assign-steps">
            <button
              type="button"
              class="btn"
              onClick={() => setCurrent(index - 1)}
              disabled={index === 0}
            >
              Previous peak
            </button>
            <button
              type="button"
              class="btn"
              onClick={() => setCurrent(index + 1)}
              disabled={index >= ordered.length - 1}
            >
              Next peak
            </button>
          </div>
        </>
      )}

      {attached.detached.length > 0 && (
        <section class="message is-warning" aria-labelledby="detached-title">
          <h4 id="detached-title">Assignments not attached to a peak</h4>
          <p>
            No peak lies within {ASSIGNMENT_MATCH_CM} cm⁻¹ of where these were made with the current
            settings, for example because the minimum prominence was raised or a processing step
            changed the spectrum. They are kept, and attach again when a peak returns near them.
            They are not in the results table while detached.
          </p>
          <ul class="detached-list">
            {[...attached.detached]
              .sort((a, b) => b.wavenumber - a.wavenumber)
              .map((a) => (
                <li key={a.id}>
                  {formatNumber(a.wavenumber, 1)} cm⁻¹: {a.label}{' '}
                  <button
                    type="button"
                    class="btn btn-quiet"
                    aria-label={`Remove the assignment made at ${formatNumber(a.wavenumber, 1)} cm⁻¹`}
                    onClick={() => remove(a.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
          </ul>
        </section>
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

/** One row of the step: a found peak, what the user assigned to it and what the table suggests. */
interface PeakRow {
  peak: FtirPeak;
  /** The stored assignment attached to this peak, if any. */
  assignment: Assignment | undefined;
  label: string;
  suggestions: Suggestion[];
}

/** The assignment box and the suggestion table of one peak. */
function PeakCard({
  row,
  quantity,
  toleranceCm,
  setLabel,
}: {
  row: PeakRow;
  quantity: FtirQuantity;
  toleranceCm: number;
  setLabel: (row: PeakRow, label: string) => void;
}) {
  const { peak, assignment, label, suggestions } = row;
  const moved =
    assignment && Math.abs(assignment.wavenumber - peak.wavenumber) > MOVED_NOTE_CM
      ? assignment.wavenumber
      : null;
  const id = `assign-${Math.round(peak.wavenumber * 10)}`;
  return (
    <div class="assign-row">
      <h4 class="assign-peak">
        {formatNumber(peak.wavenumber, 1)} cm⁻¹{' '}
        <span class="field-hint">
          {quantity === 'absorbance'
            ? `absorbance ${formatNumber(peak.height, 3)}`
            : `transmittance ${formatNumber(valueIn(quantity, peak.height), 1)} %`}
          , {formatNumber(peak.relative, 0)} % of the highest absorbance
        </span>
      </h4>
      <div class="inline-field">
        <label for={id}>Your assignment</label>
        <AssignmentInput id={id} label={label} onCommit={(text) => setLabel(row, text)} />
        {label !== '' && (
          <button type="button" class="btn btn-quiet" onClick={() => setLabel(row, '')}>
            Remove
            <span class="visually-hidden"> assignment at {formatNumber(peak.wavenumber, 1)}</span>
          </button>
        )}
      </div>
      {moved !== null && (
        <p class="field-hint">
          This assignment was made when the peak was at {formatNumber(moved, 1)} cm⁻¹; the
          processing has moved the peak since. Check that it is the same band.
        </p>
      )}
      {suggestions.length === 0 ? (
        <p class="field-hint">Nothing in the table lies within {toleranceCm} cm⁻¹ of this peak.</p>
      ) : (
        <>
          <div
            class="table-scroll"
            tabIndex={0}
            role="region"
            aria-label={`Suggestions for ${formatNumber(peak.wavenumber, 1)} cm⁻¹`}
          >
            <table class="peak-table suggestion-table">
              <thead>
                <tr>
                  <th scope="col">Suggestion</th>
                  <th scope="col">Listed at</th>
                  <th scope="col">Distance (cm⁻¹)</th>
                  <th scope="col">
                    <span class="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">{s.label}</th>
                    <td>{s.listed}</td>
                    <td>{s.offset === 0 ? 'inside' : formatNumber(s.offset, 0)}</td>
                    <td>
                      <button
                        type="button"
                        class="btn"
                        onClick={() => setLabel(row, s.label)}
                        disabled={label === s.label}
                      >
                        {label === s.label ? 'Accepted' : 'Accept'}
                        <span class="visually-hidden"> {s.label}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {suggestions
            .filter((s) => s.kind === 'atmosphere')
            .map((s) => (
              <p key={s.id} class="message is-warning">
                <strong>Check:</strong> {s.reason}
              </p>
            ))}
        </>
      )}
    </div>
  );
}

/**
 * The text box for one peak's assignment. What the user types is kept here until they leave the
 * box or press Enter, so a redraw of the step while typing never puts the old text back.
 */
function AssignmentInput({
  id,
  label,
  onCommit,
}: {
  id: string;
  label: string;
  onCommit: (text: string) => void;
}) {
  const [draft, setDraft] = useState(label);
  useEffect(() => setDraft(label), [label]);
  return (
    <input
      id={id}
      type="text"
      value={draft}
      placeholder="none yet"
      onInput={(e) => setDraft(e.currentTarget.value)}
      onChange={(e) => {
        if (e.currentTarget.value !== label) onCommit(e.currentTarget.value);
      }}
    />
  );
}
