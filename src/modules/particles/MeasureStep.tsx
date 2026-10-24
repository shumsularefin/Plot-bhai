import { useMemo, useState } from 'preact/hooks';
import {
  measure,
  nmPerPixel,
  NM_PER_UNIT,
  UNIT_LABELS,
  type LengthUnit,
  type Measurement,
  type MeasurementKind,
  type Point,
} from '../../core/particles/geometry';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { CoordinateFields } from './CoordinateFields';
import { calibrationOf, type ParticleData } from './data';
import { ImageGate } from './ImageGate';
import { ImageViewer, type DrawTool, type Tool } from './ImageViewer';

const TOOLS: { tool: Tool; label: string; hint: string }[] = [
  { tool: 'pan', label: 'Move the image', hint: 'Drag to move the image.' },
  {
    tool: 'line',
    label: 'Line',
    hint: 'Drag from one end of what you want to measure to the other.',
  },
  {
    tool: 'circle',
    label: 'Circle',
    hint: 'Drag across the particle along a diameter. A circle of that diameter is drawn.',
  },
  {
    tool: 'ellipse',
    label: 'Ellipse',
    hint: 'Drag a box around the particle. The ellipse inside the box is measured; its axes are parallel to the image edges.',
  },
];
const KIND_NAMES: Record<MeasurementKind, string> = {
  line: 'Line',
  circle: 'Circle',
  ellipse: 'Ellipse',
};

/** Wizard step 3: measure particles by hand with a line, a circle or an ellipse. */
export function MeasureStep({ data, update }: StepContext<ParticleData>) {
  const [tool, setTool] = useState<Tool>('circle');
  const [shape, setShape] = useState<MeasurementKind>('circle');
  const calibration = calibrationOf(data.scale);
  const [unit, setUnit] = useState<LengthUnit>(data.scale?.unit ?? 'nm');
  const perPixelNm = calibration ? nmPerPixel(calibration) : null;
  const rows = useMemo(
    () => data.measurements.map((m) => ({ m, sizes: measure(m) })),
    [data.measurements],
  );
  const info = data.image;
  if (!info) return <p>No image is loaded. Go back to step 1 to add one.</p>;

  const add = (kind: MeasurementKind, a: Point, b: Point) =>
    update({
      measurements: [...data.measurements, { id: data.nextId, kind, a, b }],
      nextId: data.nextId + 1,
    });
  const draw = (drawn: DrawTool, a: Point, b: Point) => {
    if (drawn === 'line' || drawn === 'circle' || drawn === 'ellipse') add(drawn, a, b);
  };
  const remove = (id: number) =>
    update({ measurements: data.measurements.filter((m) => m.id !== id) });

  /** A length in px as text in the chosen unit, or in px when there is no scale. */
  const length = (px: number) =>
    perPixelNm === null
      ? `${formatNumber(px, 4)} px`
      : `${formatNumber((px * perPixelNm) / NM_PER_UNIT[unit], 4)} ${UNIT_LABELS[unit]}`;
  const areaText = (px2: number) =>
    perPixelNm === null
      ? `${formatNumber(px2, 5)} px²`
      : `${formatNumber((px2 * perPixelNm ** 2) / NM_PER_UNIT[unit] ** 2, 4)} ${UNIT_LABELS[unit]}²`;
  const current = TOOLS.find((t) => t.tool === tool);

  return (
    <div class="particle-step">
      {!calibration && (
        <p class="message is-warning" role="status">
          <strong>No scale yet:</strong> sizes are shown in pixels. Go back to step 2 and draw the
          scale bar to get nanometres.
        </p>
      )}
      <ImageGate data={data}>
        {(image) => (
          <>
            <div class="tool-buttons" role="group" aria-label="Tool">
              {TOOLS.map((t) => (
                <button
                  key={t.tool}
                  type="button"
                  class="btn"
                  aria-pressed={tool === t.tool}
                  onClick={() => setTool(t.tool)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p class="field-hint">{current?.hint}</p>
            <ImageViewer
              image={image}
              tool={tool}
              crop={data.crop}
              measurements={data.measurements}
              onDraw={draw}
              label="Image for measuring particles"
            />
            <CoordinateFields
              action="Add the measurement"
              width={info.width}
              height={info.height}
              onApply={(a, b) => add(shape, a, b)}
            >
              <label class="inline-field">
                Shape
                <select
                  value={shape}
                  onChange={(e) => setShape(e.currentTarget.value as MeasurementKind)}
                >
                  {(Object.keys(KIND_NAMES) as MeasurementKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_NAMES[k]}
                    </option>
                  ))}
                </select>
              </label>
            </CoordinateFields>
          </>
        )}
      </ImageGate>

      <section class="peak-table-section" aria-labelledby="measure-title">
        <div class="peak-table-header">
          <h3 id="measure-title" class="process-step-title">
            Measurements ({rows.length}){' '}
            <HelpTip term="measurement table">
              <p>
                A line gives its length. A circle gives its diameter and area (π d² / 4). An ellipse
                gives its longer and shorter axis, its area (π · long · short / 4) and the aspect
                ratio (long / short). Sizes are in the unit you choose when a scale is set,
                otherwise in pixels.
              </p>
            </HelpTip>
          </h3>
          <div class="clean-actions">
            <label class="inline-field">
              Show sizes in
              <select
                value={unit}
                onChange={(e) => setUnit(e.currentTarget.value as LengthUnit)}
                disabled={!calibration}
              >
                {(['nm', 'um'] as const).map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              class="btn"
              onClick={() => update({ measurements: data.measurements.slice(0, -1) })}
              disabled={rows.length === 0}
            >
              Undo the last
            </button>
            <button
              type="button"
              class="btn"
              onClick={() => {
                if (window.confirm('Delete all measurements?')) update({ measurements: [] });
              }}
              disabled={rows.length === 0}
            >
              Delete all
            </button>
            <button
              type="button"
              class="btn"
              disabled={rows.length === 0}
              onClick={() => downloadMeasurements(data.measurements, perPixelNm, info.name)}
            >
              Download CSV
            </button>
          </div>
        </div>
        {rows.length === 0 ? (
          <p class="field-hint">Nothing measured yet. Draw on the image above.</p>
        ) : (
          <div
            class="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Measurements, scrolls sideways"
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
                      <button type="button" class="btn btn-quiet" onClick={() => remove(m.id)}>
                        Delete<span class="visually-hidden"> measurement {m.id}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
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
