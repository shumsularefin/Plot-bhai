import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { autoRange, DEFAULT_ADJUST, type AdjustSettings } from '../../core/particles/detect/adjust';
import type { DetectSettings } from '../../core/particles/detect/pipeline';
import { histogram } from '../../core/particles/detect/threshold';
import { Advanced } from '../../ui/Advanced';
import { Dock } from '../../ui/Dock';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import type { ParticleData } from './data';
import type { DecodedImage } from './decode';
import { DetectClient } from './detectClient';
import { GrayHistogram } from './GrayHistogram';
import { grayCanvas, grayOf, workingArea, workingSize } from './grayImage';
import { ImageGate } from './ImageGate';
import { ImageViewer, type ViewerImage } from './ImageViewer';

const PREVIEW_DELAY_MS = 300;
const UNDO_LIMIT = 30;

/** The settings this step changes; the others belong to Detect particles. */
type Prepared = Pick<DetectSettings, 'invert' | 'adjust' | 'denoise'>;

const DEFAULT_PREPARED: Prepared = {
  invert: false,
  adjust: DEFAULT_ADJUST,
  denoise: { method: 'gaussian', size: 1 },
};

/**
 * Wizard step 3: get the image ready for finding particles, in the order ImageJ users work
 * (Process › Subtract Background, Image › Adjust › Brightness/Contrast, Process › Smooth). Only
 * the image the particles are found on changes; grey values are measured on the original.
 */
export function AdjustStep({ data, update }: StepContext<ParticleData>) {
  return (
    <div class="particle-step">
      <p class="message">
        <strong>Optional.</strong> Make the particles stand out from the background. Most images
        need only the first part; change the others if the next step marks the wrong areas. The
        changes are used to find the particles; sizes come from the outlines, and grey values are
        read from the original image.
      </p>
      <ImageGate data={data}>
        {(image) => <Adjuster data={data} update={update} image={image} />}
      </ImageGate>
    </div>
  );
}

function Adjuster({ data, update, image }: StepContext<ParticleData> & { image: DecodedImage }) {
  const { settings } = data.detect;
  const adjust = settings.adjust;
  const work = useMemo(() => workingSize(image), [image]);
  const area = useMemo(() => workingArea(data.crop, work.scale), [data.crop, work.scale]);
  const [show, setShow] = useState<'adjusted' | 'original'>('adjusted');
  const [preview, setPreview] = useState<{
    image: ViewerImage;
    after: Int32Array;
    before: Int32Array;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const client = useRef(new DetectClient());
  const grayRef = useRef<{ id: string; value: ReturnType<typeof grayOf> } | null>(null);
  const history = useRef<Prepared[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => () => client.current.cancel(), []);

  const prepared: Prepared = {
    invert: settings.invert,
    adjust: settings.adjust,
    denoise: settings.denoise,
  };
  const key = JSON.stringify({ prepared, area });

  useEffect(() => {
    setBusy(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const id = data.image?.id ?? '';
          if (grayRef.current?.id !== id) grayRef.current = { id, value: grayOf(image) };
          const g = grayRef.current.value;
          const result = await client.current.adjust({
            gray: g.gray,
            width: g.width,
            height: g.height,
            settings,
            area,
          });
          if (result === null) return;
          setBusy(false);
          if (result === 'error') {
            setProblem('The preview could not be made. Try a smaller image.');
            return;
          }
          setProblem(null);
          setPreview({
            image: {
              source: grayCanvas(result.image, g.width, g.height),
              width: image.width,
              height: image.height,
              workScale: image.workScale,
            },
            after: histogram(result.image, g.width, area),
            before: result.rangeHistogram,
          });
        } catch {
          setBusy(false);
          setProblem('The image could not be prepared in this browser.');
        }
      })();
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, image]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (patch: Partial<Prepared>) => {
    history.current = [...history.current, prepared].slice(-UNDO_LIMIT);
    setCanUndo(true);
    update({ detect: { ...data.detect, settings: { ...settings, ...patch } } });
  };
  const patchAdjust = (patch: Partial<AdjustSettings>) =>
    change({ adjust: { ...adjust, ...patch } });
  const undo = () => {
    const last = history.current[history.current.length - 1];
    if (!last) return;
    history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    update({ detect: { ...data.detect, settings: { ...settings, ...last } } });
  };
  const atDefaults = JSON.stringify(prepared) === JSON.stringify(DEFAULT_PREPARED);

  const range = adjust.range ?? { min: 0, max: 255 };
  const setRange = (min: number, max: number) =>
    patchAdjust({ range: min === 0 && max === 255 ? null : { min, max } });
  const auto = () => {
    const found = preview ? autoRange(preview.before) : null;
    if (found) setRange(found.min, found.max);
    else
      setProblem(
        'Brightness and contrast cannot be set automatically: the image has one grey level only.',
      );
  };

  return (
    <>
      <section class="process-step is-on" aria-labelledby="adjust-look-title">
        <h3 id="adjust-look-title" class="process-step-title">
          1. What do the particles look like?{' '}
          <HelpTip term="particle tone">
            <p>
              The program looks for bright areas. In most TEM images and in back-scattered SEM
              images of light particles on a heavy substrate the particles are darker than the
              background; the image is then turned negative (inverted) before the threshold, as
              ImageJ's Edit › Invert does. The image on screen is not inverted.
            </p>
          </HelpTip>
        </h3>
        <fieldset class="method-choice">
          <legend>The particles are</legend>
          {(
            [
              [false, 'Brighter than the background (most SEM images)'],
              [true, 'Darker than the background (most TEM images)'],
            ] as const
          ).map(([invert, name]) => (
            <label key={name} class="check">
              <input
                type="radio"
                name="particle-tone"
                checked={settings.invert === invert}
                onChange={() => change({ invert })}
              />
              {name}
            </label>
          ))}
        </fieldset>
      </section>

      <section class="process-step is-on" aria-labelledby="adjust-bc-title">
        <h3 id="adjust-bc-title" class="process-step-title">
          2. Brightness and contrast{' '}
          <HelpTip term="brightness and contrast">
            <p>
              Stretches a range of grey levels over the full scale from black to white, as ImageJ's
              Image › Adjust › Brightness/Contrast does when you press Apply. Levels darker than the
              minimum become black and brighter than the maximum white. Auto chooses the range so
              that 0.35 % of the pixels become fully black or white, as ImageJ's Auto button and
              Enhance Contrast do. A dim or washed-out image becomes clearer to look at and to
              threshold by hand; Otsu and the other automatic thresholds are hardly affected.
            </p>
          </HelpTip>
        </h3>
        <div class="clean-actions">
          <button type="button" class="btn" onClick={auto} disabled={!preview}>
            Auto
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => setRange(0, 255)}
            disabled={adjust.range === null}
          >
            Reset brightness and contrast
          </button>
        </div>
        <label class="slider-field">
          Minimum (becomes black): <strong>{range.min}</strong>
          <input
            type="range"
            min={0}
            max={254}
            step={1}
            value={range.min}
            onInput={(e) => {
              const min = Number(e.currentTarget.value);
              setRange(min, Math.max(range.max, min + 1));
            }}
          />
        </label>
        <label class="slider-field">
          Maximum (becomes white): <strong>{range.max}</strong>
          <input
            type="range"
            min={1}
            max={255}
            step={1}
            value={range.max}
            onInput={(e) => {
              const max = Number(e.currentTarget.value);
              setRange(Math.min(range.min, max - 1), max);
            }}
          />
        </label>
        {preview && (
          <GrayHistogram
            hist={preview.before}
            markers={[
              { level: range.min, label: 'minimum' },
              { level: range.max, label: 'maximum' },
            ]}
            label="Histogram of grey levels before brightness and contrast, with the minimum and maximum"
          />
        )}
      </section>

      <section class="process-step is-on" aria-labelledby="adjust-bg-title">
        <h3 id="adjust-bg-title" class="process-step-title">
          3. Uneven background{' '}
          <HelpTip term="background subtraction">
            <p>
              When one side of the image is brighter than the other, one threshold cannot suit the
              whole image. This estimates the background as the brightness that a square window
              wider than the particles can reach (a grey-level opening, the flat-window version of
              ImageJ's Process › Subtract Background "rolling ball") and subtracts it. Choose a
              radius larger than the largest particle, or the particles are partly subtracted too.
            </p>
          </HelpTip>
        </h3>
        <label class="check">
          <input
            type="checkbox"
            checked={adjust.background.enabled}
            onChange={(e) =>
              patchAdjust({
                background: { ...adjust.background, enabled: e.currentTarget.checked },
              })
            }
          />
          Subtract the background
        </label>
        {adjust.background.enabled && (
          <div class="radiation-fields">
            <NumberInput
              label="Window radius (px)"
              value={adjust.background.radius}
              min={1}
              max={500}
              step={1}
              onChange={(v) =>
                v !== null &&
                v >= 1 &&
                patchAdjust({ background: { ...adjust.background, radius: v } })
              }
            />
          </div>
        )}
      </section>

      <section class="process-step is-on" aria-labelledby="adjust-noise-title">
        <h3 id="adjust-noise-title" class="process-step-title">
          4. Noise{' '}
          <HelpTip term="noise smoothing">
            <p>
              Electron micrographs are grainy. A light blur (about 1 pixel, ImageJ's Process ›
              Filters › Gaussian Blur) or a median filter (Process › Noise › Despeckle is a median
              of radius 1) evens out the grain so the threshold does not pick it up. Too much
              smoothing rounds the outlines and joins close particles.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <label class="inline-field">
            Smoothing of noise
            <select
              value={settings.denoise.method}
              onChange={(e) =>
                change({
                  denoise: {
                    ...settings.denoise,
                    method: e.currentTarget.value as DetectSettings['denoise']['method'],
                    size: Math.max(1, Math.min(3, Math.round(settings.denoise.size))),
                  },
                })
              }
            >
              <option value="none">None</option>
              <option value="gaussian">Gaussian blur</option>
              <option value="median">Median filter (despeckle, slower)</option>
            </select>
          </label>
          {settings.denoise.method !== 'none' && (
            <NumberInput
              label={
                settings.denoise.method === 'gaussian' ? 'Blur width σ (px)' : 'Median radius (px)'
              }
              value={settings.denoise.size}
              min={0}
              max={settings.denoise.method === 'median' ? 3 : 10}
              step={settings.denoise.method === 'median' ? 1 : 0.5}
              onChange={(v) => v !== null && change({ denoise: { ...settings.denoise, size: v } })}
            />
          )}
        </div>
      </section>

      <Advanced id="particle-adjust-more" title="Sharpen and equalise">
        <label class="check">
          <input
            type="checkbox"
            checked={adjust.sharpen.enabled}
            onChange={(e) =>
              patchAdjust({ sharpen: { ...adjust.sharpen, enabled: e.currentTarget.checked } })
            }
          />
          Sharpen (unsharp mask){' '}
          <HelpTip term="unsharp mask">
            <p>
              Makes blurred edges steeper by subtracting a blurred copy of the image, as ImageJ's
              Process › Filters › Unsharp Mask: new = (old − w · blurred) / (1 − w). Helps when
              particle edges are soft; it also makes noise stronger, so smooth a little as well.
            </p>
          </HelpTip>
        </label>
        {adjust.sharpen.enabled && (
          <div class="radiation-fields">
            <NumberInput
              label="Blur width σ (px)"
              value={adjust.sharpen.sigma}
              min={0.5}
              max={20}
              step={0.5}
              onChange={(v) =>
                v !== null && v > 0 && patchAdjust({ sharpen: { ...adjust.sharpen, sigma: v } })
              }
            />
            <NumberInput
              label="Mask weight (0.1 to 0.9)"
              value={adjust.sharpen.weight}
              min={0.1}
              max={0.9}
              step={0.1}
              onChange={(v) =>
                v !== null &&
                v >= 0.1 &&
                v <= 0.9 &&
                patchAdjust({ sharpen: { ...adjust.sharpen, weight: v } })
              }
            />
          </div>
        )}
        <label class="check">
          <input
            type="checkbox"
            checked={adjust.equalize}
            onChange={(e) => patchAdjust({ equalize: e.currentTarget.checked })}
          />
          Equalise the histogram{' '}
          <HelpTip term="histogram equalisation">
            <p>
              Spreads the grey levels so that each is about equally common (Process › Enhance
              Contrast › Equalize in ImageJ, which uses a square-root variant; this is the classic
              form). It brings out faint detail but changes the relation between grey levels, so use
              it only to help find particles, never to compare brightness.
            </p>
          </HelpTip>
        </label>
      </Advanced>

      <div class="clean-actions">
        <button type="button" class="btn" onClick={undo} disabled={!canUndo}>
          Undo the last change
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => change(DEFAULT_PREPARED)}
          disabled={atDefaults}
        >
          Reset all adjustments
        </button>
      </div>

      <div class="adjust-view" role="group" aria-label="Image shown">
        {(
          [
            ['adjusted', 'Adjusted'],
            ['original', 'Original'],
          ] as const
        ).map(([value, name]) => (
          <button
            key={value}
            type="button"
            class="btn"
            aria-pressed={show === value}
            onClick={() => setShow(value)}
          >
            {name}
          </button>
        ))}
        <span class="upload-status" role="status">
          {busy ? 'Updating the preview…' : ''}
        </span>
      </div>
      {problem && (
        <p class="message is-error" role="alert">
          <strong>Problem:</strong> {problem}
        </p>
      )}
      <Dock label="Adjusted image">
        <ImageViewer
          image={show === 'adjusted' && preview ? preview.image : image}
          tool="pan"
          crop={data.crop}
          focusCrop
          label={show === 'adjusted' ? 'Adjusted image' : 'Original image'}
        />
      </Dock>
      {preview && (
        <GrayHistogram
          hist={preview.after}
          label="Histogram of grey levels of the adjusted image inside the crop area"
        />
      )}
    </>
  );
}
