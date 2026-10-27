import { useMemo } from 'preact/hooks';
import type { StepContext } from '../../ui/wizard/types';
import type { ShotData } from './data';
import { calibrationOf, digitize } from './digitized';
import type { ShotImage } from './prepare';
import { ShotGate } from './ShotGate';
import { useTarget } from './target';

/** Wizard step 4: name the curve and add it to the analysis tool. */
export function SendStep({ data, update }: StepContext<ShotData>) {
  const { tool } = useTarget();
  return (
    <div class="particle-step shot-step">
      <p>
        The digitized curve goes back to the {tool} analysis and continues like a loaded data file.
        It stays marked as approximate in every table, export and methods text.
      </p>
      <label class="inline-field">
        Name
        <input
          type="text"
          value={data.name}
          placeholder={data.image?.name.replace(/\.[^.]+$/, '') ?? 'Digitized curve'}
          onInput={(e) => update({ name: e.currentTarget.value })}
        />
      </label>
      <ShotGate data={data}>{(image) => <Handoff data={data} image={image} />}</ShotGate>
    </div>
  );
}

function Handoff({ data, image }: { data: ShotData; image: ShotImage }) {
  const { axes, Send } = useTarget();
  const outcome = calibrationOf(data, axes);
  const calibration = 'calibration' in outcome ? outcome.calibration : null;
  const result = useMemo(
    () => digitize(data, image, calibration, axes),
    // The trace depends only on these parts of the data.
    [image, data.curve, data.crop, data.marks, data.yScale, data.image], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if ('problem' in outcome)
    return (
      <p class="message is-warning">
        <strong>Check:</strong> the axes are not calibrated. {outcome.problem} (step 2)
      </p>
    );
  if (!result?.curve)
    return (
      <p class="message is-warning">
        <strong>Check:</strong> no curve has been digitized yet. Pick the curve in step 3.
      </p>
    );
  const x = (v: number) => `${v.toFixed(axes.xDigits)}${axes.xUnit}`;
  const { curve } = result;
  return (
    <>
      <dl class="summary-grid">
        <div>
          <dt>{axes.x.charAt(0).toUpperCase() + axes.x.slice(1)} range</dt>
          <dd>
            {x(curve.x[0] as number)} to {x(curve.x[curve.x.length - 1] as number)}
          </dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{curve.x.length}</dd>
        </div>
      </dl>
      <p class="message is-warning">
        <strong>Approximate:</strong> the values are read off a picture. Peak positions are good to
        about a pixel; heights and widths of narrow peaks are rough.
      </p>
      {data.image?.synthetic && (
        <p class="message is-info">
          <strong>Example:</strong> this is the synthetic example figure, not published data.
        </p>
      )}
      <Send data={data} curve={curve} result={result} />
    </>
  );
}
