import { useMemo } from 'preact/hooks';
import {
  measure,
  NM_PER_UNIT,
  UNIT_LABELS,
  type LengthUnit,
  type Measurement,
  type MeasurementKind,
  type Point,
} from '../../core/particles/geometry';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { downloadCsv } from '../xrd/csv';
import { CoordinateFields } from './CoordinateFields';

const KIND_NAMES: Record<MeasurementKind, string> = {
  line: 'Line',
  circle: 'Circle',
  ellipse: 'Ellipse',
};

interface HandMeasurementsProps {
  measurements: readonly Measurement[];
  /** Size of the original image, for typed coordinates. */
  width: number;
  height: number;
  /** nm per pixel of the original image, or null without a scale. */
  perPixelNm: number | null;
  /** Unit of the sizes shown; px also when there is no scale. */
  unit: 'px' | LengthUnit;
  name: string;
  /** Adds a line between two points of the original image. */
  onAddLine: (a: Point, b: Point) => void;
  /** Replaces the list (delete one, undo the last, delete all). */
  onChange: (measurements: Measurement[]) => void;
}

/**
 * Lengths measured by hand with the line tool of the detection step (and circles or ellipses
 * measured in sessions saved before those became particles), with typed coordinates as a keyboard
 * alternative, a table and a CSV download.
 */
export function HandMeasurements(props: HandMeasurementsProps) {
  const { measurements, perPixelNm, onChange } = props;
  const unit = perPixelNm === null || props.unit === 'px' ? null : props.unit;
  const rows = useMemo(() => measurements.map((m) => ({ m, sizes: measure(m) })), [measurements]);

  /** A length in px as text in the chosen unit, or in px when there is no scale. */
  const length = (px: number) =>
    perPixelNm === null || unit === null
      ? `${formatNumber(px, 4)} px`
      : `${formatNumber((px * perPixelNm) / NM_PER_UNIT[unit], 4)} ${UNIT_LABELS[unit]}`;
  const areaText = (px2: number) =>
    perPixelNm === null || unit === null
      ? `${formatNumber(px2, 5)} px²`
      : `${formatNumber((px2 * perPixelNm ** 2) / NM_PER_UNIT[unit] ** 2, 4)} ${UNIT_LABELS[unit]}²`;

  return (
    <section class="peak-table-section" aria-labelledby="hand-title">
      <div class="peak-table-header">
        <h3 id="hand-title" class="process-step-title">
          Measured by hand ({rows.length}){' '}
          <HelpTip term="hand measurements">
            <p>
              Draw with "Add a line" across a particle the detection could not outline, for example
              one hidden in a clump. A line gives its length, used as the particle's diameter if you
              include hand measurements in the distribution (next step). Circles and ellipses
              measured in older sessions also give an area and, for an ellipse, the aspect ratio
              (long / short). Sizes are in the unit chosen for the particle table above.
            </p>
          </HelpTip>
        </h3>
        <div class="clean-actions">
          <button
            type="button"
            class="btn"
            onClick={() => {
              if (window.confirm('Delete all hand measurements?')) onChange([]);
            }}
            disabled={rows.length === 0}
          >
            Delete all
          </button>
          <button
            type="button"
            class="btn"
            disabled={rows.length === 0}
            onClick={() => downloadMeasurements(measurements, perPixelNm, props.name)}
          >
            Download CSV
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p class="field-hint">
          Nothing measured by hand yet. Choose "Add a line" and drag across a particle.
        </p>
      ) : (
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Hand measurements, scrolls sideways"
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Type</th>
                <th scope="col">Length or long axis</th>
                <th scope="col">Short axis</th>
                <th scope="col">Area</th>
                <th scope="col">Aspect ratio</th>
                <th scope="col">Delete</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, sizes }) => (
                <tr key={m.id}>
                  <th scope="row">{m.id}</th>
                  <td>{KIND_NAMES[m.kind]}</td>
                  <td>{length(sizes.major)}</td>
                  <td>{m.kind === 'ellipse' ? length(sizes.minor) : '–'}</td>
                  <td>{m.kind === 'line' ? '–' : areaText(sizes.area)}</td>
                  <td>{m.kind === 'ellipse' ? formatNumber(sizes.aspectRatio, 3) : '–'}</td>
                  <td>
                    <button
                      type="button"
                      class="btn btn-quiet"
                      onClick={() => onChange(measurements.filter((x) => x.id !== m.id))}
                    >
                      Delete<span class="visually-hidden"> measurement {m.id}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CoordinateFields
        action="Add the line"
        width={props.width}
        height={props.height}
        onApply={props.onAddLine}
      />
    </section>
  );
}

/** Downloads every measurement with its pixel coordinates and sizes in pixels and, with a scale, in nm. */
function downloadMeasurements(
  measurements: readonly Measurement[],
  perPixelNm: number | null,
  name: string,
) {
  const rows = measurements.map((m) => ({ m, s: measure(m) }));
  const nm = (px: number) => (perPixelNm === null ? '' : px * perPixelNm);
  downloadCsv(
    `${name}-measurements`,
    `Manual particle measurements on ${name}. Coordinates are pixels of the original image (x right, y down). Sizes in nm use the scale bar drawn by the user${perPixelNm === null ? ' (none was set, so those columns are empty)' : ''}. Circles are drawn along a diameter; ellipses as a box with axes parallel to the image edges.`,
    rows,
    [
      { header: 'ID', value: (r) => r.m.id },
      { header: 'Type', value: (r) => r.m.kind },
      { header: 'x1 (px)', value: (r) => r.m.a.x },
      { header: 'y1 (px)', value: (r) => r.m.a.y },
      { header: 'x2 (px)', value: (r) => r.m.b.x },
      { header: 'y2 (px)', value: (r) => r.m.b.y },
      { header: 'Length or long axis (px)', value: (r) => r.s.major },
      { header: 'Short axis (px)', value: (r) => r.s.minor },
      { header: 'Area (px2)', value: (r) => r.s.area },
      {
        header: 'Aspect ratio',
        value: (r) => (Number.isFinite(r.s.aspectRatio) ? r.s.aspectRatio : ''),
      },
      { header: 'Length or long axis (nm)', value: (r) => nm(r.s.major) },
      { header: 'Short axis (nm)', value: (r) => nm(r.s.minor) },
      {
        header: 'Area (nm2)',
        value: (r) => (perPixelNm === null ? '' : r.s.area * perPixelNm ** 2),
      },
      { header: 'Area-equivalent diameter (nm)', value: (r) => nm(r.s.equivalentDiameter) },
    ],
  );
}
