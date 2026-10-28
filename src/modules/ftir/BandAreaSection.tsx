import { useMemo } from 'preact/hooks';
import { bandArea, type BandArea } from '../../core/ftir/bands';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { downloadCsv } from '../xrd/csv';
import { NumberInput } from '../xrd/NumberInput';
import type { BandContext } from './BandsStep';
import type { AreaRange } from './data';

const fmt = (v: number | null | undefined, digits: number) =>
  v !== null && v !== undefined && Number.isFinite(v) ? formatNumber(v, digits) : '–';

/** Integrated band areas over wavenumber ranges and their ratios to one reference band. */
export function BandAreaSection({ spectrum, processed, settings, set }: BandContext) {
  const st = settings.areas;
  const areas = useMemo(
    () =>
      st.ranges.map((r): BandArea | null =>
        r.fromCm !== null && r.toCm !== null
          ? bandArea(processed.wavenumber, processed.absorbance, r.fromCm, r.toCm)
          : null,
      ),
    [processed, st.ranges],
  );
  const reference = areas[st.reference]?.area;
  const ratio = (a: BandArea | null) =>
    a && reference !== undefined && reference !== 0 ? a.area / reference : null;
  const setRange = (i: number, patch: Partial<AreaRange>) =>
    set({ areas: { ranges: st.ranges.map((r, j) => (j === i ? { ...r, ...patch } : r)) } });
  const remove = (i: number) =>
    set({
      areas: {
        ranges: st.ranges.filter((_, j) => j !== i),
        reference: st.reference > i ? st.reference - 1 : st.reference === i ? 0 : st.reference,
      },
    });
  const refLabel = st.ranges[st.reference]?.label || `range ${st.reference + 1}`;

  const download = () =>
    downloadCsv(
      `${spectrum.name}-band-areas`,
      `Integrated band areas of ${spectrum.name} (processed absorbance), trapezoid rule above a straight line joining the spectrum at the two ends of each range, in absorbance x cm-1. Ratios are to ${refLabel}.`,
      st.ranges.map((r, i) => ({ r, a: areas[i] ?? null })),
      [
        { header: 'Band', value: (row) => row.r.label },
        { header: 'From (cm-1)', value: (row) => row.a?.fromCm ?? '' },
        { header: 'To (cm-1)', value: (row) => row.a?.toCm ?? '' },
        { header: 'Area', value: (row) => row.a?.area ?? '' },
        { header: 'Highest point (cm-1)', value: (row) => row.a?.peakCm ?? '' },
        { header: 'Height above line', value: (row) => row.a?.height ?? '' },
        { header: `Ratio to ${refLabel}`, value: (row) => ratio(row.a) ?? '' },
      ],
    );

  return (
    <section class="process-step is-on" aria-labelledby="areas-title">
      <h3 id="areas-title" class="process-step-title">
        Band areas and ratios{' '}
        <HelpTip term="band area">
          <p>
            The area of a band is ∫ (A − b) dν̃ over the range you give, by the trapezoid rule, where
            b is a straight line joining the spectrum at the two ends of the range (a local
            baseline). Choose ends where the band has returned to the baseline.
          </p>
          <p>
            Ratios of band areas (for example carbonyl index = A(C=O) / A(reference)) compare
            samples measured the same way. They are relative numbers: absolute amounts need a
            calibration.
          </p>
        </HelpTip>
      </h3>
      {st.ranges.length > 0 && (
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Band areas, scrolls sideways"
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">Band</th>
                <th scope="col">From (cm⁻¹)</th>
                <th scope="col">To (cm⁻¹)</th>
                <th scope="col">Area</th>
                <th scope="col">Highest at (cm⁻¹)</th>
                <th scope="col">Reference</th>
                <th scope="col">Ratio</th>
                <th scope="col">
                  <span class="visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {st.ranges.map((r, i) => {
                const a = areas[i] ?? null;
                return (
                  <tr key={i}>
                    <td>
                      <input
                        type="text"
                        aria-label={`Name of range ${i + 1}`}
                        value={r.label}
                        placeholder={`range ${i + 1}`}
                        onInput={(e) => setRange(i, { label: e.currentTarget.value })}
                      />
                    </td>
                    <td>
                      <NumberInput
                        label={`Range ${i + 1} from (cm⁻¹)`}
                        value={r.fromCm}
                        min={0}
                        onChange={(fromCm) => setRange(i, { fromCm })}
                      />
                    </td>
                    <td>
                      <NumberInput
                        label={`Range ${i + 1} to (cm⁻¹)`}
                        value={r.toCm}
                        min={0}
                        onChange={(toCm) => setRange(i, { toCm })}
                      />
                    </td>
                    <td>{fmt(a?.area, 4)}</td>
                    <td>{fmt(a?.peakCm, 1)}</td>
                    <td>
                      <input
                        type="radio"
                        name="ftir-area-reference"
                        aria-label={`Divide by range ${i + 1}`}
                        checked={st.reference === i}
                        onChange={() => set({ areas: { reference: i } })}
                      />
                    </td>
                    <td>{fmt(ratio(a), 4)}</td>
                    <td>
                      <button type="button" class="btn" onClick={() => remove(i)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {areas.some(
        (a, i) => a === null && st.ranges[i]?.fromCm !== null && st.ranges[i]?.toCm !== null,
      ) && (
        <p class="message is-warning">
          <strong>Check:</strong> a range reaches beyond the spectrum or has equal ends, so it has
          no area.
        </p>
      )}
      {areas.some((a) => a !== null && a.area < 0) && (
        <p class="message is-warning">
          <strong>Check:</strong> a negative area means the spectrum lies below the line joining the
          range ends. Move the ends to where the band starts and stops.
        </p>
      )}
      <div class="export-actions">
        <button
          type="button"
          class="btn"
          onClick={() =>
            set({ areas: { ranges: [...st.ranges, { fromCm: null, toCm: null, label: '' }] } })
          }
        >
          Add a range
        </button>
        <button type="button" class="btn" disabled={st.ranges.length === 0} onClick={download}>
          Band areas (CSV)
        </button>
      </div>
      {st.ranges.length === 0 && (
        <p class="field-hint">Add a range for each band whose area you need.</p>
      )}
    </section>
  );
}
