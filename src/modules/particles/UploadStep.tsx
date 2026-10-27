import { useRef, useState } from 'preact/hooks';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { initialParticleData, newId, type ImageInfo, type ParticleData } from './data';
import { decodeImage } from './decode';
import { EXAMPLE_DESCRIPTION, makeExampleImage } from './example';
import { ImageGate } from './ImageGate';
import { ImageViewer } from './ImageViewer';
import { removeImage, saveImage } from './imageStore';
import { cacheImage, clearImageCache } from './useImage';

const FORMAT_NAMES = { png: 'PNG', jpeg: 'JPEG', tiff: 'TIFF' } as const;

/** Wizard step 1: load a micrograph by drag and drop, file picker, or the example image. */
export function UploadStep({ data, update }: StepContext<ParticleData>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const hasWork = data.measurements.length > 0 || data.scale !== null || data.crop !== null;

  const load = async (name: string, blob: Blob, synthetic: boolean) => {
    if (
      hasWork &&
      !window.confirm('Replace the image? This clears the scale, the crop and your measurements.')
    ) {
      return;
    }
    setBusy('Opening the image…');
    setProblem(null);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = await decodeImage(name, bytes, blob);
    if (!result.ok) {
      setProblem(result.error);
      setBusy(null);
      return;
    }
    const { image } = result;
    const id = newId();
    try {
      await saveImage(id, blob);
    } catch {
      image.notes.push(
        'This browser would not store the image, so it will have to be loaded again after a refresh.',
      );
    }
    cacheImage(id, image);
    const info: ImageInfo = {
      id,
      name,
      width: image.width,
      height: image.height,
      format: image.format,
      synthetic,
      notes: image.notes,
    };
    update({ ...initialParticleData, pool: data.pool, image: info });
    setBusy(null);
  };

  const loadFiles = (list: FileList | null) => {
    const file = list?.[0];
    if (file) void load(file.name, file, false);
  };

  const loadExample = async () => {
    setBusy('Drawing the example…');
    try {
      await load('example-particles-synthetic.png', await makeExampleImage(), true);
    } catch {
      setProblem('The example image could not be drawn in this browser.');
      setBusy(null);
    }
  };

  const remove = () => {
    clearImageCache();
    void removeImage();
    update({ ...initialParticleData, pool: data.pool });
  };

  const info = data.image;
  return (
    <div class="particle-step">
      <p>
        Load a scanning or transmission electron microscope image (SEM or TEM) of your particles{' '}
        <HelpTip term="particle size from an image">
          <p>
            The size of each particle is measured on the image and converted to nanometres with the
            scale bar that is part of the picture. You mark the scale bar once, then measure
            particles by hand (this sub-stage), later also automatically.
          </p>
        </HelpTip>
      </p>

      {info && (
        <article class="pattern-card" aria-label="Loaded image">
          <header class="pattern-card-header">
            <div class="pattern-name-field">
              <strong>{info.name}</strong>
              <span class="badge">{FORMAT_NAMES[info.format]}</span>
              {info.synthetic && <span class="badge badge-accent">Synthetic, not real data</span>}
            </div>
            <button type="button" class="btn btn-quiet" onClick={remove}>
              Remove<span class="visually-hidden"> the image</span>
            </button>
          </header>
          <ImageGate data={data}>
            {(image) => (
              <>
                <dl class="summary-grid">
                  <div>
                    <dt>Size</dt>
                    <dd>
                      {info.width} × {info.height} pixels
                    </dd>
                  </div>
                  <div>
                    <dt>Megapixels</dt>
                    <dd>{((info.width * info.height) / 1e6).toFixed(1)}</dd>
                  </div>
                  <div>
                    <dt>Shown at</dt>
                    <dd>
                      {image.workScale < 1
                        ? `${Math.round(image.workScale * 100)} % (smaller working copy)`
                        : 'full size'}
                    </dd>
                  </div>
                </dl>
                {image.workScale < 1 && (
                  <p class="message">
                    <strong>Note:</strong> this image is large, so a smaller working copy is shown
                    and used for automatic detection. Everything you measure is converted back to
                    the pixels of the original image.
                  </p>
                )}
                {info.synthetic && <p class="message">{EXAMPLE_DESCRIPTION}</p>}
                {info.notes.map((note) => (
                  <p key={note} class="message is-warning">
                    <strong>Check:</strong> {note}
                  </p>
                ))}
                <ImageViewer image={image} tool="pan" label="Preview of the loaded image" />
              </>
            )}
          </ImageGate>
        </article>
      )}

      <div
        class={`drop-zone${info ? ' is-compact' : ''}${dragging ? ' is-dragging' : ''}`}
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
        {info ? (
          <p class="drop-zone-line">
            <strong>Use another image</strong> by dropping it here, or
          </p>
        ) : (
          <>
            <p class="drop-zone-title">Drag and drop an image here</p>
            <p class="field-hint">
              PNG, JPEG or TIFF (8 or 16 bit grayscale, or colour). The image stays on your device.
              Gatan .dm3 and .dm4 files must be exported as PNG or TIFF first.
            </p>
          </>
        )}
        <button
          type="button"
          class={info ? 'btn' : 'btn btn-primary'}
          onClick={() => fileInput.current?.click()}
        >
          Choose an image
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".png,.jpg,.jpeg,.tif,.tiff,image/png,image/jpeg,image/tiff"
          class="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            loadFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </div>

      {!info && (
        <div class="upload-actions">
          <button type="button" class="btn" onClick={() => void loadExample()}>
            Try with example data
          </button>
          <span class="field-hint">
            Draws a synthetic image with discs of known size. It is not a real micrograph.
          </span>
        </div>
      )}

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
    </div>
  );
}
