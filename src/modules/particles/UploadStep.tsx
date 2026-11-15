import { useRef, useState } from 'preact/hooks';
import { HelpTip } from '../../ui/HelpTip';
import { SessionSection } from '../../ui/SessionSection';
import type { StepContext } from '../../ui/wizard/types';
import { initialParticleData, newId, type ImageInfo, type ParticleData } from './data';
import { decodeImage } from './decode';
import { EXAMPLE_DESCRIPTION, makeExampleImage } from './example';
import { ImageGate } from './ImageGate';
import { ImageViewer } from './ImageViewer';
import { removeImage, saveImage } from './imageStore';
import { PARTICLE_SESSION_HINT, particleSession } from './session';
import { cacheImage, clearImageCache, useImage } from './useImage';

/** SHA-256 of the file as hex, or null where the browser offers no Web Crypto (plain http). */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string | null> {
  try {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

const sizeText = (bytes: number) =>
  bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`;

const FORMAT_NAMES = { png: 'PNG', jpeg: 'JPEG', tiff: 'TIFF' } as const;

/** Wizard step 1: load a micrograph by drag and drop, file picker, or the example image. */
export function UploadStep({ data, update }: StepContext<ParticleData>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageState = useImage(data.image);
  const hasWork =
    data.measurements.length > 0 ||
    data.scale !== null ||
    data.crop !== null ||
    data.detect.particles.length > 0;
  // A session opened from a file, or an image the browser dropped: the numbers are here, the
  // pixels are not.
  const missing = data.image !== null && imageState.status === 'error';

  const load = async (name: string, blob: Blob, synthetic: boolean) => {
    setProblem(null);
    setNote(null);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    const old = data.image;
    const same = missing && old?.sha256 != null && old.sha256 === sha256;
    if (!same && hasWork) {
      const question =
        missing && old
          ? `This is not the image the session was made with (${old.name}): ${old.sha256 && sha256 ? 'the file contents differ' : 'it cannot be checked, the session has no fingerprint of the file'}. The scale, crop and particles of the session would not fit it. Load it anyway and clear them? Saved images in the pool are kept.`
          : 'Replace the image? This clears the scale, the crop and your measurements.';
      if (!window.confirm(question)) return;
    }
    setBusy('Opening the image…');
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
    if (same && old) {
      update({ image: { ...old, id, notes: image.notes } });
      setNote(
        `This is the image the session was made with (same file fingerprint), so its scale, crop and particles are shown on it again.`,
      );
      setBusy(null);
      return;
    }
    const info: ImageInfo = {
      id,
      name,
      width: image.width,
      height: image.height,
      format: image.format,
      synthetic,
      notes: image.notes,
      bytes: bytes.length,
      sha256,
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
          {missing && (
            <p class="message is-warning">
              <strong>Image needed:</strong> this session holds the numbers measured on {info.name}
              {info.bytes !== null &&
                ` (${sizeText(info.bytes)}, ${info.width} × ${info.height} pixels)`}
              , but not the image itself. The distribution, the tables and the pooled images work
              without it. To see or change the scale, the crop or the particles, load the same file
              below; a different file is recognised and you are asked first.
            </p>
          )}
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
        {busy ?? note}
      </p>
      {problem && (
        <div class="import-problems" role="alert">
          <p>{problem}</p>
          <button type="button" class="btn btn-quiet" onClick={() => setProblem(null)}>
            Dismiss
          </button>
        </div>
      )}
      {!info && (
        <SessionSection
          codec={particleSession}
          data={data}
          update={update}
          step={0}
          stem="particles"
          hint={PARTICLE_SESSION_HINT}
        />
      )}
    </div>
  );
}
