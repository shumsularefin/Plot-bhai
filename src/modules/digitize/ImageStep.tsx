import { useEffect, useRef, useState } from 'preact/hooks';
import type { Point, Rect } from '../../core/particles/geometry';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { ImageViewer } from '../particles/ImageViewer';
import { DEFAULT_CURVE, EMPTY_MARKS, initialShotData, type ShotData } from './data';
import { removeShot, saveShot } from './imageStore';
import { cacheShot, clearShotCache, decodeShot, type ShotImage } from './prepare';
import { ShotGate } from './ShotGate';
import { useTarget, type ExampleFigure } from './target';

/** Wizard step 1: load the screenshot, straighten it and crop it to the plot. */
export function ImageStep({ data, update }: StepContext<ShotData>) {
  const target = useTarget();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const hasWork = data.marks.x1.at !== null || data.curve.seeds.length > 0;

  const load = async (name: string, blob: Blob, figure: ExampleFigure | null) => {
    const synthetic = figure !== null;
    if (hasWork && !window.confirm('Replace the image? This clears the calibration and the curve.'))
      return;
    setBusy('Opening the image…');
    setProblem(null);
    const result = await decodeShot(blob);
    if (!result.ok) {
      setProblem(result.error);
      setBusy(null);
      return;
    }
    const id = crypto.randomUUID();
    const notes = [...result.notes];
    try {
      await saveShot(target.imageKey, id, blob);
    } catch {
      notes.push(
        'This browser would not store the image, so it will have to be loaded again after a refresh.',
      );
    }
    cacheShot(id, result.bitmap);
    const stem = name.replace(/\.[^.]+$/, '');
    update({
      ...initialShotData,
      plot: data.plot,
      image: {
        id,
        name,
        width: result.width,
        height: result.height,
        synthetic,
        notes,
        ...(figure && { description: figure.description }),
      },
      name: synthetic ? 'Example figure (synthetic)' : `${stem} (digitized)`,
      ...(figure && {
        crop: figure.crop,
        marks: figure.marks,
        curve: { ...DEFAULT_CURVE, color: figure.color, seeds: [figure.seed] },
      }),
    });
    setBusy(null);
  };

  const loadFiles = (list: FileList | null) => {
    const file = list?.[0];
    if (file) void load(file.name, file, null);
  };

  const loadExample = async () => {
    setBusy('Drawing the example…');
    try {
      const figure = await target.example();
      await load('example-figure-synthetic.png', figure.blob, figure);
    } catch {
      setProblem('The example figure could not be drawn in this browser.');
      setBusy(null);
    }
  };

  // A pasted screenshot (Ctrl+V or Cmd+V) is loaded like a file.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        event.preventDefault();
        void load('pasted-screenshot.png', file, null);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const remove = () => {
    clearShotCache();
    void removeShot(target.imageKey);
    update({ ...initialShotData, plot: data.plot });
  };

  /** Turning the image moves every pixel, so the crop, marks and curve start again. */
  const rotate = (rotation: number) => {
    const next = Math.round(((((rotation + 180) % 360) + 360) % 360) * 10) / 10 - 180;
    if (
      hasWork &&
      !window.confirm('Turning the image clears the calibration marks and the curve. Continue?')
    )
      return;
    update({
      rotation: next,
      crop: null,
      marks: EMPTY_MARKS,
      curve: { ...data.curve, seeds: [], erased: [], added: [] },
    });
  };

  const info = data.image;
  return (
    <div class="particle-step shot-step">
      <p>
        Load a picture of {target.figure}, for example a screenshot of a figure in a paper{' '}
        <HelpTip term="digitizing a figure">
          <p>
            The curve is read off the picture pixel by pixel and turned back into numbers using the
            axis ticks you mark. The result is only as good as the picture: it is an approximation
            of the measured data, never the data itself.
          </p>
        </HelpTip>
      </p>

      <div
        class={`drop-zone${dragging ? ' is-dragging' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          loadFiles(e.dataTransfer?.files ?? null);
        }}
      >
        <p class="drop-zone-title">Drag and drop an image here, or paste a screenshot</p>
        <p class="field-hint">
          PNG, JPEG or WebP. A sharp, large image of the figure gives the best result. The image
          stays on your device.
        </p>
        <button type="button" class="btn btn-primary" onClick={() => fileInput.current?.click()}>
          Choose an image
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          class="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            loadFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </div>

      <div class="upload-actions">
        <button type="button" class="btn" onClick={() => void loadExample()}>
          Try with example data
        </button>
        <span class="field-hint">
          Draws a synthetic figure, already calibrated, so every step can be tried at once.
        </span>
      </div>

      <p class="upload-status" role="status">
        {busy}
      </p>
      {problem && (
        <div class="import-problems" role="alert">
          <p>{problem}</p>
          <button type="button" class="btn btn-quiet" onClick={() => setProblem(null)}>
            Dismiss
          </button>
        </div>
      )}

      {info && (
        <article class="pattern-card" aria-label="Loaded image">
          <header class="pattern-card-header">
            <div class="pattern-name-field">
              <strong>{info.name}</strong>
              <span class="badge">
                {info.width} × {info.height} px
              </span>
              {info.synthetic && <span class="badge badge-accent">Synthetic, not real data</span>}
            </div>
            <button type="button" class="btn btn-quiet" onClick={remove}>
              Remove<span class="visually-hidden"> the image</span>
            </button>
          </header>
          {info.description && <p class="message">{info.description}</p>}
          {info.notes.map((note) => (
            <p key={note} class="message is-warning">
              <strong>Check:</strong> {note}
            </p>
          ))}

          <fieldset class="method-choice shot-rotate">
            <legend>Straighten</legend>
            <button type="button" class="btn" onClick={() => rotate(data.rotation - 90)}>
              Turn left 90°
            </button>
            <button type="button" class="btn" onClick={() => rotate(data.rotation + 90)}>
              Turn right 90°
            </button>
            <label class="inline-field">
              <span>
                Fine angle (°){' '}
                <HelpTip term="straightening">
                  <p>
                    A photographed or skewed figure should be turned until its {target.axes.x} axis
                    is level: the curve is read one pixel column at a time. The calibration in step
                    2 says how far off the axis still is.
                  </p>
                </HelpTip>
              </span>
              <input
                type="number"
                step="0.1"
                min="-180"
                max="180"
                inputMode="decimal"
                aria-label="Rotation in degrees, clockwise"
                value={data.rotation}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  if (Number.isFinite(v) && v !== data.rotation) rotate(v);
                }}
              />
            </label>
          </fieldset>

          <ShotGate data={data}>
            {(image) => (
              <>
                <p class="field-hint">
                  Drag a box just inside the plot frame, around the curve but leaving out the tick
                  labels, legend and caption where you can; drag its edges or inside to adjust it.
                </p>
                <ImageViewer
                  image={image}
                  tool="crop"
                  crop={data.crop}
                  onCropChange={(crop) => update({ crop })}
                  onDraw={(_tool, a, b) => update({ crop: rectFrom(a, b, image) })}
                  label="Screenshot: drag to crop to the plot"
                />
                <div class="upload-actions">
                  {data.crop && (
                    <button type="button" class="btn" onClick={() => update({ crop: null })}>
                      Use the whole image
                    </button>
                  )}
                </div>
                <h3 class="export-subtitle">Preview of what will be analysed</h3>
                <CropPreview image={image} crop={data.crop} />
              </>
            )}
          </ShotGate>
        </article>
      )}
    </div>
  );
}

/** A rectangle from two corners, kept inside the image. */
function rectFrom(a: Point, b: Point, image: ShotImage): Rect {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(image.width, Math.max(a.x, b.x));
  const y1 = Math.min(image.height, Math.max(a.y, b.y));
  return {
    x: Math.round(x0),
    y: Math.round(y0),
    width: Math.round(x1 - x0),
    height: Math.round(y1 - y0),
  };
}

/** The cropped, straightened image at a fixed width, as the later steps will read it. */
function CropPreview({ image, crop }: { image: ShotImage; crop: Rect | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const area = crop ?? { x: 0, y: 0, width: image.width, height: image.height };
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx || area.width < 1 || area.height < 1) return;
    element.width = area.width;
    element.height = area.height;
    ctx.drawImage(
      image.source,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      area.width,
      area.height,
    );
  }, [image, area.x, area.y, area.width, area.height]);
  return (
    <canvas
      ref={canvas}
      class="shot-preview"
      role="img"
      aria-label={`Cropped plot, ${area.width} × ${area.height} pixels`}
    />
  );
}
