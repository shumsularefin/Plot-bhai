import { useMemo, useState } from 'preact/hooks';
import type { Spectrum } from '../../core/uvvis/types';
import { DataSources, ImageSourceLink } from '../../ui/DataSources';
import { FileDrop } from '../../ui/FileDrop';
import { HelpTip } from '../../ui/HelpTip';
import { MAX_SERIES } from '../../ui/plot/palette';
import type { StepContext } from '../../ui/wizard/types';
import { exampleSpectra, newId, type UvvisData, type ViewSettings } from './data';
import { importSpectra } from './importClient';
import { SpectrumCard } from './SpectrumCard';
import { UvvisPlot } from './UvvisPlot';
import { shownCurves } from './view';

const MEASURED_VIEW: ViewSettings = { quantity: 'measured', xUnit: 'nm' };

interface ImportProblem {
  name: string;
  error: string;
}

/** Wizard step 1: load spectra by drag and drop, file picker, paste, or example data. */
export function UploadStep({ data, update }: StepContext<UvvisData>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<ImportProblem[]>([]);
  const [pasted, setPasted] = useState('');
  const [removed, setRemoved] = useState<{ spectrum: Spectrum; index: number } | null>(null);
  const spectra = data.spectra;
  const full = spectra.length >= MAX_SERIES;
  const shown = useMemo(
    () =>
      shownCurves(
        spectra.map((s) => ({
          spectrum: s,
          id: s.id,
          name: s.name,
          wavelengthNm: s.wavelengthNm,
          values: s.values,
        })),
        MEASURED_VIEW,
      ),
    [spectra],
  );

  const importAll = async (
    requests: Parameters<typeof importSpectra>[0][],
    names: string[],
  ): Promise<number> => {
    setBusy(requests.length === 1 ? 'Reading the data…' : `Reading ${requests.length} files…`);
    setRemoved(null);
    const results = await Promise.all(requests.map(importSpectra));
    const found: ImportProblem[] = [];
    const added: Spectrum[] = [];
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
    if (room > 0 && added.length > 0) update({ spectra: [...spectra, ...added.slice(0, room)] });
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
    update({ spectra: [...spectra, ...examples.slice(0, room)] });
  };

  const changeSpectrum = (id: string, patch: Partial<Spectrum>) =>
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
        Load one or more UV-Vis spectra: absorbance, transmittance or reflectance measured against
        wavelength{' '}
        <HelpTip term="UV-Vis spectrum">
          <p>
            A UV-Vis spectrometer shines light of changing wavelength (in nanometres) on a sample
            and records how much is absorbed, transmitted or reflected. The wavelength at which a
            material starts to absorb strongly gives its optical band gap, which the next sub-stages
            of this tool calculate.
          </p>
        </HelpTip>
      </p>

      {spectra.length === 0 && (
        <>
          <DataSources imageHref="#/uvvis/image">
            <FileDrop
              formats=".csv, .txt or .dat with wavelength (nm) in the first column and one or more spectra in the other columns. Files stay on your device."
              onFiles={importFiles}
              disabled={full}
            />
          </DataSources>
          <div class="upload-actions">
            <button type="button" class="btn" onClick={loadExample} disabled={full}>
              Try with example data
            </button>
            <span class="field-hint">
              Loads three synthetic spectra, generated by this site. They are not real measurements.
            </span>
          </div>

          <details class="paste-box">
            <summary>Paste data instead</summary>
            <div class="field paste-field">
              <label for="uvvis-paste">Two columns: wavelength in nm and the spectrum</label>
              <textarea
                id="uvvis-paste"
                rows={6}
                spellcheck={false}
                value={pasted}
                placeholder={'300  0.452\n301  0.447\n…'}
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
        <SpectrumCard
          key={spectrum.id}
          spectrum={spectrum}
          onChange={(patch) => changeSpectrum(spectrum.id, patch)}
          onRemove={() => remove(index)}
        />
      ))}

      {spectra.length > 0 && (
        <section class="add-more" aria-label="Add more data">
          <FileDrop
            formats=".csv, .txt or .dat with wavelength (nm) in the first column and one or more spectra in the other columns. Files stay on your device."
            onFiles={importFiles}
            disabled={full}
            compact
          />
          <ImageSourceLink href="#/uvvis/image" />
          <details class="paste-box">
            <summary>Paste data instead</summary>
            <div class="field paste-field">
              <label for="uvvis-paste">Two columns: wavelength in nm and the spectrum</label>
              <textarea
                id="uvvis-paste"
                rows={6}
                spellcheck={false}
                value={pasted}
                placeholder={'300  0.452\n301  0.447\n…'}
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

      {shown.curves.length > 0 && (
        <UvvisPlot
          curves={shown.curves}
          view={MEASURED_VIEW}
          quantity={shown.quantity}
          settings={data.plot}
          onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
          exportName={spectra.length === 1 ? (spectra[0] as Spectrum).name : 'uvvis-spectra'}
        />
      )}
    </div>
  );
}
