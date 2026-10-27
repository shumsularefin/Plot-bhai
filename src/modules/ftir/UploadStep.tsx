import { useMemo, useState } from 'preact/hooks';
import { importFtirFile, importFtirText } from '../../core/ftir/import';
import type { FtirImportResult, FtirSpectrum } from '../../core/ftir/types';
import { DataSources, ImageSourceLink } from '../../ui/DataSources';
import { FileDrop } from '../../ui/FileDrop';
import { HelpTip } from '../../ui/HelpTip';
import { MAX_SERIES } from '../../ui/plot/palette';
import type { StepContext } from '../../ui/wizard/types';
import { exampleSpectra, newId, type FtirData } from './data';
import { FtirPlot, type FtirCurve } from './FtirPlot';
import { FtirSpectrumCard } from './FtirSpectrumCard';
import { QuantityChoice } from './QuantityChoice';
import { defaultQuantity, shownQuantity } from './quantity';
import { toAbsorbance } from '../../core/ftir/process';

type Request = { kind: 'file'; file: File } | { kind: 'text'; name: string; text: string };

/**
 * Reads a file or pasted text. FTIR files are small (a few thousand rows), so this runs on the
 * main thread; parsing takes a few milliseconds.
 */
async function read(request: Request): Promise<FtirImportResult> {
  try {
    return request.kind === 'file'
      ? importFtirFile(request.file.name, new Uint8Array(await request.file.arrayBuffer()))
      : importFtirText(request.name, request.text, 'pasted');
  } catch {
    return { ok: false, error: 'Something went wrong while reading this file.' };
  }
}

/** Wizard step 1: load spectra by drag and drop, file picker, paste, or example data. */
export function UploadStep({ data, update }: StepContext<FtirData>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ name: string; error: string }[]>([]);
  const [pasted, setPasted] = useState('');
  const [removed, setRemoved] = useState<{ spectrum: FtirSpectrum; index: number } | null>(null);
  const spectra = data.spectra;
  const full = spectra.length >= MAX_SERIES;
  // The raw data are drawn here, before any processing, so nothing is normalised yet.
  const shown = shownQuantity({ view: data.view, processing: {} }, spectra);

  const curves = useMemo<FtirCurve[]>(
    () =>
      spectra.map((s) => ({
        id: s.id,
        name: s.name,
        wavenumber: s.wavenumber,
        absorbance: toAbsorbance(s.values, s.kind, s.scale),
      })),
    [spectra],
  );

  /** Adds spectra; the first ones loaded also set the display quantity to match the data. */
  const addSpectra = (added: FtirSpectrum[]) =>
    update({
      spectra: [...spectra, ...added],
      ...(spectra.length === 0 && { view: { ...data.view, quantity: defaultQuantity(added) } }),
    });

  const importAll = async (requests: Request[], names: string[]): Promise<number> => {
    setBusy(requests.length === 1 ? 'Reading the data…' : `Reading ${requests.length} files…`);
    setRemoved(null);
    const results = await Promise.all(requests.map(read));
    const found: { name: string; error: string }[] = [];
    const added: FtirSpectrum[] = [];
    results.forEach((result, i) => {
      if (result.ok) added.push(...result.spectra.map((s) => ({ ...s, id: newId() })));
      else found.push({ name: names[i] as string, error: result.error });
    });
    const room = Math.max(MAX_SERIES - spectra.length, 0);
    if (added.length > room) {
      found.push({
        name: 'Too many spectra',
        error: `Up to ${MAX_SERIES} spectra can be loaded at once. ${added.length - room} were not added; remove some, then load them again.`,
      });
    }
    if (room > 0 && added.length > 0) addSpectra(added.slice(0, room));
    setProblems(found);
    setBusy(null);
    return Math.min(added.length, room);
  };

  const importFiles = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    void importAll(
      files.map((file) => ({ kind: 'file' as const, file })),
      files.map((file) => file.name),
    );
  };

  const importPasted = async () => {
    const name = `Pasted data ${spectra.filter((s) => s.source === 'pasted').length + 1}`;
    const loaded = await importAll([{ kind: 'text', name, text: pasted }], [name]);
    if (loaded > 0) setPasted('');
  };

  const loadExample = () => {
    setProblems([]);
    setRemoved(null);
    const room = Math.max(MAX_SERIES - spectra.length, 0);
    const examples = exampleSpectra().filter((e) => !spectra.some((s) => s.name === e.name));
    addSpectra(examples.slice(0, room));
  };

  const change = (id: string, patch: Partial<FtirSpectrum>) =>
    update({ spectra: spectra.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const remove = (index: number) => {
    const spectrum = spectra[index];
    if (!spectrum) return;
    setRemoved({ spectrum, index });
    update({ spectra: spectra.filter((_, i) => i !== index) });
  };

  const undoRemove = () => {
    if (!removed) return;
    const next = [...spectra];
    next.splice(Math.min(removed.index, next.length), 0, removed.spectrum);
    update({ spectra: next });
    setRemoved(null);
  };

  return (
    <div class="upload-step">
      <p>
        Load one or more infrared spectra: absorbance or transmittance against wavenumber{' '}
        <HelpTip term="wavenumber">
          <p>
            Wavenumber (in cm⁻¹, reciprocal centimetres) is the number of wave cycles per
            centimetre: 10 000 divided by the wavelength in micrometres. Infrared spectra are
            normally drawn with the highest wavenumber on the left. Different chemical bonds absorb
            at different wavenumbers, which is what the later steps use.
          </p>
        </HelpTip>
      </p>

      {spectra.length === 0 && (
        <>
          <DataSources imageHref="#/ftir/image">
            <FileDrop
              formats=".csv, .txt, .dpt or JCAMP-DX (.jdx, .dx) with wavenumber (cm⁻¹) in the first column and one or more spectra in the other columns. Files stay on your device."
              onFiles={importFiles}
              disabled={full}
            />
          </DataSources>
          <div class="upload-actions">
            <button type="button" class="btn" onClick={loadExample} disabled={full}>
              Try with example data
            </button>
            <span class="field-hint">
              Loads two synthetic spectra, generated by this site. They are not real measurements.
            </span>
          </div>

          <details class="paste-box">
            <summary>Paste data instead</summary>
            <div class="field paste-field">
              <label for="ftir-paste">Two columns: wavenumber in cm⁻¹ and the spectrum</label>
              <textarea
                id="ftir-paste"
                rows={6}
                spellcheck={false}
                value={pasted}
                placeholder={'4000  0.012\n3998  0.013\n…'}
                onInput={(e) => setPasted(e.currentTarget.value)}
              />
              <button
                type="button"
                class="btn"
                onClick={() => void importPasted()}
                disabled={pasted.trim() === '' || full}
              >
                Load pasted data
              </button>
            </div>
          </details>
        </>
      )}

      <p class="upload-status" role="status">
        {busy}
        {removed && (
          <>
            Removed {removed.spectrum.name}.{' '}
            <button type="button" class="btn btn-quiet" onClick={undoRemove}>
              Undo
            </button>
          </>
        )}
      </p>

      {problems.length > 0 && (
        <div class="import-problems" role="alert">
          <ul>
            {problems.map((p, i) => (
              <li key={i}>
                <strong>{p.name}:</strong> {p.error}
              </li>
            ))}
          </ul>
          <button type="button" class="btn btn-quiet" onClick={() => setProblems([])}>
            Dismiss
          </button>
        </div>
      )}

      {spectra.map((spectrum, index) => (
        <FtirSpectrumCard
          key={spectrum.id}
          spectrum={spectrum}
          onChange={(patch) => change(spectrum.id, patch)}
          onRemove={() => remove(index)}
        />
      ))}

      {spectra.length > 0 && (
        <section class="add-more" aria-label="Add more data">
          <FileDrop
            formats=".csv, .txt, .dpt or JCAMP-DX (.jdx, .dx) with wavenumber (cm⁻¹) in the first column and one or more spectra in the other columns. Files stay on your device."
            onFiles={importFiles}
            disabled={full}
            compact
          />
          <ImageSourceLink href="#/ftir/image" />
          <details class="paste-box">
            <summary>Paste data instead</summary>
            <div class="field paste-field">
              <label for="ftir-paste">Two columns: wavenumber in cm⁻¹ and the spectrum</label>
              <textarea
                id="ftir-paste"
                rows={6}
                spellcheck={false}
                value={pasted}
                placeholder={'4000  0.012\n3998  0.013\n…'}
                onInput={(e) => setPasted(e.currentTarget.value)}
              />
              <button
                type="button"
                class="btn"
                onClick={() => void importPasted()}
                disabled={pasted.trim() === '' || full}
              >
                Load pasted data
              </button>
            </div>
          </details>
        </section>
      )}

      {curves.length > 0 && <QuantityChoice data={data} update={update} shown={shown} />}
      {curves.length > 0 && (
        <FtirPlot
          curves={curves}
          quantity={shown.quantity}
          settings={data.plot}
          onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
          exportName={spectra.length === 1 ? (spectra[0] as FtirSpectrum).name : 'ftir-spectra'}
        />
      )}
    </div>
  );
}
