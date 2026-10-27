import { useMemo, useState } from 'preact/hooks';
import { backgroundColor, pickCurve, type Rgb } from '../../core/digitize/extract';
import type { Point } from '../../core/particles/geometry';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { StepContext } from '../../ui/wizard/types';
import { ImageViewer, type Tool } from '../particles/ImageViewer';
import { downloadCsv } from '../xrd/csv';
import type { ShotData } from './data';
import { calibrationOf, digitize, type Digitization } from './digitized';
import type { ShotImage } from './prepare';
import { ShotGate } from './ShotGate';
import { useTarget } from './target';

type Mode = 'pick' | 'seed' | 'erase' | 'add' | 'pan';

const MODES: { id: Mode; label: string; hint: string }[] = [
  {
    id: 'pick',
    label: 'Pick the curve',
    hint: 'Click on the curve to read. Its colour is taken from where you click.',
  },
  {
    id: 'seed',
    label: 'Add a start point',
    hint: 'Click on a part of the same curve the trace missed (after a gap or a label).',
  },
  {
    id: 'erase',
    label: 'Erase points',
    hint: 'Drag a box over wrongly traced points (a legend, a label, another curve).',
  },
  {
    id: 'add',
    label: 'Add points by hand',
    hint: 'Click where the curve really is; each click replaces the traced point of that pixel column.',
  },
  {
    id: 'pan',
    label: 'Move the image',
    hint: 'Drag to move the image; pinch or Ctrl + scroll to zoom.',
  },
];

const TOOL_OF: Record<Mode, Tool> = {
  pick: 'select',
  seed: 'select',
  add: 'select',
  erase: 'crop',
  pan: 'pan',
};

const hex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Wizard step 3: read the curve off the image and correct it. */
export function CurveStep({ data, update }: StepContext<ShotData>) {
  const [mode, setMode] = useState<Mode>(data.curve.seeds.length > 0 ? 'pan' : 'pick');
  const setCurve = (patch: Partial<ShotData['curve']>) =>
    update({ curve: { ...data.curve, ...patch } });
  return (
    <div class="particle-step shot-step">
      <p>
        Click on the curve to read it. The trace follows the line of that colour from where you
        click, skipping axes and gridlines{' '}
        <HelpTip term="tracing the curve">
          <p>
            Pixels close to the curve&apos;s colour are kept, straight lines across the whole plot
            are dropped, and the trace walks along the connected line from your click. With several
            curves of one colour, the one you click is followed. Labels or legends touching the
            curve can be erased, and missed parts added by hand.
          </p>
        </HelpTip>
      </p>
      <ShotGate data={data}>
        {(image) => (
          <CurveWorkspace
            data={data}
            update={update}
            image={image}
            mode={mode}
            setMode={setMode}
            setCurve={setCurve}
          />
        )}
      </ShotGate>
    </div>
  );
}

interface WorkspaceProps extends Pick<StepContext<ShotData>, 'data' | 'update'> {
  image: ShotImage;
  mode: Mode;
  setMode: (mode: Mode) => void;
  setCurve: (patch: Partial<ShotData['curve']>) => void;
}

function CurveWorkspace({ data, update, image, mode, setMode, setCurve }: WorkspaceProps) {
  const { curve } = data;
  const { axes } = useTarget();
  const outcome = calibrationOf(data, axes);
  const calibration = 'calibration' in outcome ? outcome.calibration : null;
  const background = useMemo(
    () => backgroundColor(image.pixels, data.crop ?? undefined),
    [image, data.crop],
  );
  const result = useMemo(
    () => digitize(data, image, calibration, axes),
    // The trace depends only on these parts of the data.
    [image, curve, data.crop, data.marks, data.yScale], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [missed, setMissed] = useState(false);

  const onPick = (p: Point) => {
    setMissed(false);
    if (mode === 'add') {
      setCurve({
        added: [...curve.added, { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }],
      });
      return;
    }
    const picked = pickCurve(image.pixels, p, background);
    if (!picked) {
      setMissed(true);
      return;
    }
    if (mode === 'seed' && curve.color) setCurve({ seeds: [...curve.seeds, picked.at] });
    else {
      setCurve({ color: picked.color, seeds: [picked.at], erased: [], added: [] });
      setMode('pan');
    }
  };

  const onDraw = (_tool: Tool, a: Point, b: Point) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    setCurve({
      erased: [...curve.erased, { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }],
    });
  };

  const corrections = curve.erased.length + curve.added.length;
  return (
    <>
      <fieldset class="method-choice shot-modes">
        <legend>What a click or drag on the image does</legend>
        {MODES.map((m) => (
          <label key={m.id} class="check">
            <input
              type="radio"
              name="curve-mode"
              checked={mode === m.id}
              disabled={(m.id === 'seed' || m.id === 'erase' || m.id === 'add') && !curve.color}
              onChange={() => setMode(m.id)}
            />
            {m.label}
          </label>
        ))}
      </fieldset>
      <p class="field-hint" role="status">
        {MODES.find((m) => m.id === mode)?.hint}
      </p>
      {missed && (
        <p class="message is-warning" role="alert">
          <strong>Check:</strong> no curve was found within a few pixels of that click. Zoom in and
          click right on the line.
        </p>
      )}

      <ImageViewer
        image={image}
        tool={TOOL_OF[mode]}
        crop={data.crop}
        focusCrop={data.crop !== null}
        onPick={onPick}
        onDraw={onDraw}
        overlay={(s) => <TraceOverlay result={result} data={data} s={s} />}
        label="Plot image with the traced curve drawn over it"
      />

      <div class="radiation-fields">
        <label class="inline-field slider-field">
          <span>
            Colour tolerance{' '}
            <HelpTip term="colour tolerance">
              <p>
                How different a pixel may be from the picked colour and still count as the curve.
                Raise it for faint, blurred or compressed images; lower it when the trace jumps onto
                other curves or text.
              </p>
            </HelpTip>
          </span>
          <input
            type="range"
            min="10"
            max="250"
            step="5"
            value={curve.tolerance}
            aria-label="Colour tolerance"
            onInput={(e) => setCurve({ tolerance: Number(e.currentTarget.value) })}
          />
          <output>{curve.tolerance}</output>
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={curve.removeLines}
            onChange={(e) => setCurve({ removeLines: e.currentTarget.checked })}
          />
          Ignore axes and gridlines (straight lines across the plot)
        </label>
        {curve.color && (
          <span class="field-hint shot-swatch">
            Curve colour{' '}
            <span class="swatch" style={{ background: hex(curve.color) }} aria-hidden="true" />{' '}
            {hex(curve.color)}
          </span>
        )}
      </div>
      {corrections > 0 && (
        <div class="upload-actions">
          <span class="field-hint">
            {curve.erased.length} erased area{curve.erased.length === 1 ? '' : 's'},{' '}
            {curve.added.length} point
            {curve.added.length === 1 ? '' : 's'} added by hand.
          </span>
          <button type="button" class="btn" onClick={() => setCurve({ erased: [], added: [] })}>
            Clear the corrections
          </button>
        </div>
      )}

      {!result ? (
        <p class="message is-info">
          <strong>Next:</strong> choose "Pick the curve" and click on the curve.
        </p>
      ) : (
        <TraceSummary
          data={data}
          update={update}
          result={result}
          calibrationProblem={'problem' in outcome ? outcome.problem : null}
        />
      )}
    </>
  );
}

/** The traced curve, start points and corrections drawn over the image. */
function TraceOverlay({
  result,
  data,
  s,
}: {
  result: Digitization | null;
  data: ShotData;
  s: (p: Point) => Point;
}) {
  const path = result?.points.map((p, i) => {
    const q = s(p);
    return `${i === 0 ? 'M' : 'L'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
  });
  return (
    <g>
      {data.curve.erased.map((r, i) => {
        const a = s({ x: r.x, y: r.y });
        const b = s({ x: r.x + r.width, y: r.y + r.height });
        return (
          <rect
            key={`e${i}`}
            x={a.x}
            y={a.y}
            width={b.x - a.x}
            height={b.y - a.y}
            class="shot-erased"
          />
        );
      })}
      {path && path.length > 1 && (
        <>
          <path d={path.join('')} class="shot-trace-halo" />
          <path d={path.join('')} class="shot-trace" />
        </>
      )}
      {data.curve.seeds.map((p, i) => {
        const q = s(p);
        return <circle key={`s${i}`} cx={q.x} cy={q.y} r={6} class="shot-seed" />;
      })}
      {data.curve.added.map((p, i) => {
        const q = s(p);
        return (
          <rect key={`a${i}`} x={q.x - 4} y={q.y - 4} width={8} height={8} class="shot-added" />
        );
      })}
    </g>
  );
}

function TraceSummary({
  data,
  update,
  result,
  calibrationProblem,
}: {
  data: ShotData;
  update: StepContext<ShotData>['update'];
  result: Digitization;
  calibrationProblem: string | null;
}) {
  const { curve } = result;
  const { axes, labels } = useTarget();
  const sources = useMemo(() => {
    if (!curve) return [];
    // A reversed axis is plotted as −x, still increasing (see AxisLabels.reversed).
    const n = curve.x.length;
    const at = (i: number) => (labels.reversed ? n - 1 - i : i);
    return [
      {
        id: 'digitized',
        name: data.name || 'Digitized curve',
        x: Float64Array.from({ length: n }, (_, i) => {
          const x = curve.x[at(i)] as number;
          return labels.reversed ? -x : x;
        }),
        y: Float64Array.from({ length: n }, (_, i) => curve.y[at(i)] as number),
        unit: 'a.u.',
      },
    ];
  }, [curve, data.name, labels.reversed]);
  const x = (v: number) => `${v.toFixed(axes.xDigits)}${axes.xUnit}`;
  const exportCsv = () =>
    curve &&
    downloadCsv(
      data.name || 'digitized-curve',
      `Digitized from the figure image ${data.image?.name ?? ''}: approximate values. One image pixel = ${curve.step.toPrecision(4)} along x.`,
      Array.from(curve.x, (x, i) => ({ x, y: curve.y[i] as number })),
      [
        { header: axes.xCsv, value: (r) => r.x },
        { header: `${axes.y} (as in the figure, approximate)`, value: (r) => r.y },
      ],
    );
  return (
    <section class="peak-table-section" aria-labelledby="trace-title">
      <h3 id="trace-title" class="export-title">
        Digitized curve
      </h3>
      {calibrationProblem ? (
        <p class="message is-warning">
          <strong>Check:</strong> the axes are not calibrated yet, so the curve cannot be turned
          into numbers. {calibrationProblem} (step 2)
        </p>
      ) : curve ? (
        <>
          <dl class="summary-grid">
            <div>
              <dt>Range</dt>
              <dd>
                {x(curve.x[0] as number)} to {x(curve.x[curve.x.length - 1] as number)}
              </dd>
            </div>
            <div>
              <dt>Points</dt>
              <dd>
                {curve.x.length} (one per image pixel, {x(curve.step)} apart)
              </dd>
            </div>
            <div>
              <dt>Line thickness</dt>
              <dd>{result.extraction.lineWidth} px</dd>
            </div>
            <div>
              <dt>Straight lines ignored</dt>
              <dd>{result.extraction.removedLines}</dd>
            </div>
          </dl>
          <p class="message is-warning">
            <strong>Approximate:</strong> these values are read off a picture, not measured. Compare
            the curve drawn over the image with the figure before using them.
          </p>
          <div class="upload-actions">
            <button type="button" class="btn" onClick={exportCsv}>
              Download CSV<span class="visually-hidden"> of the digitized curve</span>
            </button>
          </div>
          <PlotPanel
            sources={sources}
            settings={data.plot}
            onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
            labels={() => labels}
            xName={axes.xShort}
            xUnit={axes.xUnit}
            exportName={data.name || 'digitized-curve'}
            dock="manual"
          />
        </>
      ) : (
        <p class="message is-warning">
          <strong>Check:</strong> too few points were traced to make a curve.
        </p>
      )}
      {result.warnings.map((w) => (
        <p key={w} class="message is-warning">
          <strong>Check:</strong> {w}
        </p>
      ))}
    </section>
  );
}
