import { useState } from 'preact/hooks';
import {
  cropBottom,
  distance,
  nmPerPixel,
  pixelsPerUnit,
  rectFromCorners,
  UNIT_LABELS,
  type LengthUnit,
  type Point,
} from '../../core/particles/geometry';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import { CoordinateFields } from './CoordinateFields';
import { calibrationOf, type ParticleData } from './data';
import { EXAMPLE_SCALE } from './example';
import { ImageGate } from './ImageGate';
import { ImageViewer, type DrawTool, type Tool } from './ImageViewer';

/** A scale bar shorter than this many pixels gives a poorly determined scale. */
const SHORT_BAR_PX = 50;

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: 'pan', label: 'Move the image' },
  { tool: 'scale', label: 'Draw the scale bar' },
  { tool: 'crop', label: 'Draw the crop area' },
];

const fixed = (value: number, digits = 3) => Number(value.toPrecision(digits)).toString();

/** Wizard step 2: crop away the data bar and calibrate the scale from the scale bar. */
export function ScaleStep({ data, update }: StepContext<ParticleData>) {
  const [tool, setTool] = useState<Tool>('scale');
  const [strip, setStrip] = useState<number | null>(null);
  const info = data.image;
  const calibration = calibrationOf(data.scale);
  const perUnit = calibration ? pixelsPerUnit(calibration, data.scale?.unit ?? 'nm') : null;
  const nm = calibration ? nmPerPixel(calibration) : null;
  const barPx = data.scale ? distance(data.scale.p1, data.scale.p2) : 0;

  if (!info) return <p>No image is loaded. Go back to step 1 to add one.</p>;

  const setBar = (p1: Point, p2: Point) =>
    update({
      scale: { p1, p2, length: data.scale?.length ?? null, unit: data.scale?.unit ?? 'nm' },
    });
  const draw = (drawn: DrawTool, a: Point, b: Point) => {
    if (drawn === 'scale') setBar(a, b);
    if (drawn === 'crop') {
      const rect = rectFromCorners(a, b, info.width, info.height);
      if (rect) update({ crop: rect });
    }
  };

  return (
    <div class="particle-step">
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
            <ImageViewer
              image={image}
              tool={tool}
              crop={data.crop}
              onCropChange={(crop) => update({ crop })}
              scale={data.scale}
              onDraw={draw}
              label="Image for the scale bar and the crop area"
            />

            <section class="process-step is-on" aria-labelledby="scale-title">
              <h3 id="scale-title" class="process-step-title">
                Scale{' '}
                <HelpTip term="scale calibration">
                  <p>
                    The microscope prints a scale bar on the image. Choose "Draw the scale bar",
                    drag along the bar from one end to the other, then type the length printed next
                    to it. The program then knows how many pixels make a nanometre. Zoom in to place
                    the ends exactly: one pixel of error on a short bar is a large error in size.
                  </p>
                </HelpTip>
              </h3>
              {!data.scale ? (
                <p class="field-hint">
                  Choose "Draw the scale bar" above and drag along the scale bar of the image. If
                  you know the size of one pixel instead, enter two points a known number of pixels
                  apart below and type the length they stand for.
                </p>
              ) : (
                <>
                  <div class="radiation-fields">
                    <NumberInput
                      label="Length of the bar"
                      value={data.scale.length}
                      min={0}
                      onChange={(length) =>
                        data.scale && update({ scale: { ...data.scale, length } })
                      }
                    />
                    <label class="inline-field">
                      Unit
                      <select
                        value={data.scale.unit}
                        onChange={(e) =>
                          data.scale &&
                          update({
                            scale: { ...data.scale, unit: e.currentTarget.value as LengthUnit },
                          })
                        }
                      >
                        {(['nm', 'um'] as const).map((u) => (
                          <option key={u} value={u}>
                            {UNIT_LABELS[u]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" class="btn" onClick={() => update({ scale: null })}>
                      Clear the scale
                    </button>
                  </div>
                  <p>
                    The bar you drew is <strong>{fixed(barPx, 5)} pixels</strong> long.
                    {perUnit !== null && nm !== null ? (
                      <>
                        {' '}
                        That is{' '}
                        <strong>
                          {fixed(perUnit, 4)} pixels per {UNIT_LABELS[data.scale.unit]}
                        </strong>
                        ; one pixel is <strong>{fixed(nm, 4)} nm</strong>.
                      </>
                    ) : (
                      <> Type the length of the bar to get the scale.</>
                    )}
                  </p>
                  {barPx > 0 && barPx < SHORT_BAR_PX && (
                    <p class="message is-warning">
                      <strong>Check:</strong> the bar is only {fixed(barPx, 3)} pixels long. A short
                      bar makes the scale uncertain, since each end can be off by about a pixel.
                      Zoom in and redraw it, or use a longer bar.
                    </p>
                  )}
                  <p class="field-hint">
                    Assumes square pixels, as is normal for SEM and TEM images. The scale stays for
                    this analysis and is saved with it.
                  </p>
                </>
              )}
              {info.synthetic && (
                <button
                  type="button"
                  class="btn"
                  onClick={() =>
                    update({
                      scale: {
                        p1: EXAMPLE_SCALE.p1,
                        p2: EXAMPLE_SCALE.p2,
                        length: EXAMPLE_SCALE.length,
                        unit: EXAMPLE_SCALE.unit,
                      },
                    })
                  }
                >
                  Use the example's scale bar (200 pixels = 100 nm)
                </button>
              )}
              <CoordinateFields
                action="Set the scale bar"
                width={info.width}
                height={info.height}
                onApply={setBar}
              />
            </section>

            <section class="process-step is-on" aria-labelledby="crop-title">
              <h3 id="crop-title" class="process-step-title">
                Crop{' '}
                <HelpTip term="crop">
                  <p>
                    The black or white strip at the bottom of an electron micrograph (the data bar)
                    holds text and the scale bar, not particles. Marking it as outside the crop area
                    keeps it out of the automatic detection. The original file is not changed, and
                    you can still draw the scale bar on it here.
                  </p>
                </HelpTip>
              </h3>
              <p class="field-hint">
                Choose "Draw the crop area" and drag over the part to analyse. Drag the white
                squares to resize it, or drag inside it to move it. The next steps show only this
                area, and particles are detected only inside it.
              </p>
              <div class="radiation-fields">
                <NumberInput
                  label="Remove a strip from the bottom (pixels)"
                  value={strip}
                  min={0}
                  onChange={setStrip}
                />
                <button
                  type="button"
                  class="btn"
                  disabled={strip === null || cropBottom(strip, info.width, info.height) === null}
                  onClick={() => {
                    const rect = strip === null ? null : cropBottom(strip, info.width, info.height);
                    if (rect) update({ crop: rect });
                  }}
                >
                  Apply
                </button>
                <button
                  type="button"
                  class="btn"
                  onClick={() => update({ crop: null })}
                  disabled={!data.crop}
                >
                  Use the whole image
                </button>
              </div>
              <p>
                {data.crop ? (
                  <>
                    Analysis area:{' '}
                    <strong>
                      {Math.round(data.crop.width)} × {Math.round(data.crop.height)} pixels
                    </strong>
                    , from x = {Math.round(data.crop.x)}, y = {Math.round(data.crop.y)}.
                  </>
                ) : (
                  <>
                    Analysis area: the whole image ({info.width} × {info.height} pixels).
                  </>
                )}
              </p>
            </section>
          </>
        )}
      </ImageGate>
    </div>
  );
}
