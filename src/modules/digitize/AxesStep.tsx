import { useState } from 'preact/hooks';
import { toData, toPixel, type Calibration } from '../../core/digitize/calibration';
import type { Point } from '../../core/particles/geometry';
import { HelpTip } from '../../ui/HelpTip';
import { niceTicks, type Tick } from '../../ui/plot/axes';
import type { StepContext } from '../../ui/wizard/types';
import { ImageViewer } from '../particles/ImageViewer';
import { calibrationOf, calibrationWarnings } from './digitized';
import type { MarkId, ShotData } from './data';
import type { ShotImage } from './prepare';
import { ShotGate } from './ShotGate';
import { useTarget, type DigitizeTarget } from './target';

interface MarkInfo {
  id: MarkId;
  label: string;
  short: string;
  hint: string;
}

/** The four calibration marks, named for the axes of the target tool. */
function marksFor({ x, y, xShort, yShort }: DigitizeTarget['axes']): MarkInfo[] {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return [
    {
      id: 'x1',
      label: `${cap(x)} point 1`,
      short: `${xShort}₁`,
      hint: `a labelled tick near the left end of the ${x} axis`,
    },
    {
      id: 'x2',
      label: `${cap(x)} point 2`,
      short: `${xShort}₂`,
      hint: `a labelled tick near the right end of the ${x} axis`,
    },
    {
      id: 'y1',
      label: `${cap(y)} point 1`,
      short: `${yShort}₁`,
      hint: `a labelled tick near the bottom of the ${y} axis`,
    },
    {
      id: 'y2',
      label: `${cap(y)} point 2`,
      short: `${yShort}₂`,
      hint: `a labelled tick near the top of the ${y} axis`,
    },
  ];
}

/** Wizard step 2: mark two ticks on each axis and type their values. */
export function AxesStep({ data, update }: StepContext<ShotData>) {
  const { axes } = useTarget();
  const MARKS = marksFor(axes);
  const [active, setActive] = useState<MarkId>(
    () => MARKS.find((m) => !data.marks[m.id].at)?.id ?? 'x1',
  );
  const setMark = (id: MarkId, patch: Partial<ShotData['marks'][MarkId]>) =>
    update({ marks: { ...data.marks, [id]: { ...data.marks[id], ...patch } } });
  const outcome = calibrationOf(data, axes);
  const calibration = 'calibration' in outcome ? outcome.calibration : null;
  const warnings = calibration ? calibrationWarnings(calibration, axes) : [];

  const place = (p: Point) => {
    const at = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
    const marks = { ...data.marks, [active]: { ...data.marks[active], at } };
    update({ marks });
    document.getElementById(`mark-${active}-value`)?.focus({ preventScroll: true });
    const next = MARKS.find((m) => !marks[m.id].at);
    if (next) setActive(next.id);
  };

  return (
    <div class="particle-step shot-step">
      <p>
        Tell the app what the axes mean: click two labelled ticks on the {axes.x} axis and two on
        the {axes.y} axis, then type the value of each{' '}
        <HelpTip term="axis calibration">
          <p>
            Two points per axis fix its scale and position. Pick ticks far apart, and zoom in to
            click exactly on them. The axes may be slightly tilted: the calibration allows for it.
          </p>
        </HelpTip>
      </p>

      <fieldset class="method-choice">
        <legend>Scale of the {axes.y} axis</legend>
        <label class="check">
          <input
            type="radio"
            name="y-scale"
            checked={data.yScale === 'linear'}
            onChange={() => update({ yScale: 'linear' })}
          />
          Linear
        </label>
        <label class="check">
          <input
            type="radio"
            name="y-scale"
            checked={data.yScale === 'log'}
            onChange={() => update({ yScale: 'log' })}
          />
          Logarithmic (ticks like 10, 100, 1000)
        </label>
      </fieldset>

      <div class="shot-marks" role="group" aria-label="Calibration points">
        {MARKS.map((m) => {
          const mark = data.marks[m.id];
          return (
            <div key={m.id} class={`shot-mark${active === m.id ? ' is-active' : ''}`}>
              <label class="check">
                <input
                  type="radio"
                  name="active-mark"
                  checked={active === m.id}
                  onChange={() => setActive(m.id)}
                />
                <span>
                  <strong>{m.label}</strong>
                  <span class="field-hint">
                    {' '}
                    {mark.at
                      ? `at ${mark.at.x.toFixed(1)}, ${mark.at.y.toFixed(1)} px`
                      : `click ${m.hint}`}
                  </span>
                </span>
              </label>
              <label class="inline-field">
                <span>Value</span>
                <input
                  id={`mark-${m.id}-value`}
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={mark.value ?? ''}
                  onInput={(e) => {
                    const text = e.currentTarget.value.trim();
                    const v = Number(text);
                    setMark(m.id, { value: text === '' || !Number.isFinite(v) ? null : v });
                  }}
                />
              </label>
              <details class="shot-mark-position">
                <summary>Position</summary>
                {(['x', 'y'] as const).map((axis) => (
                  <label key={axis} class="inline-field">
                    <span>{axis} (px)</span>
                    <input
                      type="number"
                      step="0.5"
                      inputMode="decimal"
                      value={mark.at?.[axis] ?? ''}
                      onInput={(e) => {
                        const v = Number(e.currentTarget.value);
                        if (!Number.isFinite(v) || e.currentTarget.value.trim() === '') return;
                        setMark(m.id, { at: { x: 0, y: 0, ...mark.at, [axis]: v } });
                      }}
                    />
                  </label>
                ))}
              </details>
            </div>
          );
        })}
      </div>

      <ShotGate data={data}>
        {(image) => (
          <>
            <p class="field-hint" role="status">
              Click the image to place <strong>{MARKS.find((m) => m.id === active)?.label}</strong>.
              Click again to move it. Drag to move the image; zoom in for precision.
            </p>
            <ImageViewer
              image={image}
              tool="select"
              // The whole image: the tick labels to click often lie outside the crop.
              onPick={place}
              overlay={(s) => (
                <>
                  {calibration && (
                    <CalibrationGrid
                      calibration={calibration}
                      image={image}
                      crop={data.crop}
                      s={s}
                    />
                  )}
                  {MARKS.map((m) => {
                    const at = data.marks[m.id].at;
                    if (!at) return null;
                    const p = s(at);
                    return (
                      <g key={m.id} class={`shot-mark-sign${active === m.id ? ' is-active' : ''}`}>
                        <line x1={p.x - 9} y1={p.y} x2={p.x + 9} y2={p.y} class="shape-halo" />
                        <line x1={p.x} y1={p.y - 9} x2={p.x} y2={p.y + 9} class="shape-halo" />
                        <line
                          x1={p.x - 9}
                          y1={p.y}
                          x2={p.x + 9}
                          y2={p.y}
                          class="shape shape-scale"
                        />
                        <line
                          x1={p.x}
                          y1={p.y - 9}
                          x2={p.x}
                          y2={p.y + 9}
                          class="shape shape-scale"
                        />
                        <text x={p.x + 8} y={p.y - 8} class="shape-label">
                          {m.short}
                        </text>
                      </g>
                    );
                  })}
                </>
              )}
              label="Plot image: click to place the active calibration point"
            />
          </>
        )}
      </ShotGate>

      {'problem' in outcome ? (
        <p class="message is-info">
          <strong>Next:</strong> {outcome.problem}
        </p>
      ) : (
        <p class="message">
          <strong>Check:</strong> the dashed grid drawn over the image uses your calibration. Its
          lines should sit on the figure&apos;s own ticks; if they drift, move a point or correct a
          value.
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} class="message is-warning">
          <strong>Check:</strong> {w}
        </p>
      ))}
    </div>
  );
}

/** Lines at round x and y values, drawn with the calibration, to compare with the figure's ticks. */
function CalibrationGrid({
  calibration,
  image,
  crop,
  s,
}: {
  calibration: Calibration;
  image: ShotImage;
  crop: ShotData['crop'];
  s: (p: Point) => Point;
}) {
  const area = crop ?? { x: 0, y: 0, width: image.width, height: image.height };
  const corners = [
    { x: area.x, y: area.y },
    { x: area.x + area.width, y: area.y },
    { x: area.x, y: area.y + area.height },
    { x: area.x + area.width, y: area.y + area.height },
  ].map((p) => toData(calibration, p));
  const xs = corners.map((c) => c.x);
  const ys = corners
    .map((c) => c.y)
    .filter((v) => Number.isFinite(v) && (calibration.yScale === 'linear' || v > 0));
  if (ys.length < 2) return null;
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const xTicks = niceTicks(x0, x1, 10);
  const yTicks: Tick[] =
    calibration.yScale === 'log'
      ? Array.from(
          { length: Math.floor(Math.log10(y1)) - Math.ceil(Math.log10(y0)) + 1 },
          (_, i) => 10 ** (Math.ceil(Math.log10(y0)) + i),
        ).map((value) => ({ value, label: String(value) }))
      : niceTicks(y0, y1, 8);
  const line = (a: Point, b: Point, key: string) => {
    const p = s(a);
    const q = s(b);
    return <line key={key} x1={p.x} y1={p.y} x2={q.x} y2={q.y} class="shot-grid" />;
  };
  return (
    <g aria-hidden="true">
      {xTicks.map(({ value: x }) =>
        line(toPixel(calibration, { x, y: y0 }), toPixel(calibration, { x, y: y1 }), `x${x}`),
      )}
      {yTicks.map(({ value: y }) =>
        line(toPixel(calibration, { x: x0, y }), toPixel(calibration, { x: x1, y }), `y${y}`),
      )}
      {xTicks.map(({ value: x, label }) => {
        const p = s(toPixel(calibration, { x, y: y0 }));
        return (
          <text key={`tx${x}`} x={p.x + 3} y={p.y - 4} class="shot-grid-label">
            {label}
          </text>
        );
      })}
      {yTicks.map(({ value: y, label }) => {
        const p = s(toPixel(calibration, { x: x0, y }));
        return (
          <text key={`ty${y}`} x={p.x + 4} y={p.y - 3} class="shot-grid-label">
            {label}
          </text>
        );
      })}
    </g>
  );
}
