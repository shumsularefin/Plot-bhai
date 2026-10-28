import { useState } from 'preact/hooks';
import { wavelengthFromEnergy } from '../../../core/uvvis/conversions';
import { FileDrop } from '../../../ui/FileDrop';
import type { StepContext } from '../../../ui/wizard/types';
import { importSpectra } from '../importClient';
import { uploadProblem } from './analysis';
import { initialFilmData, METHOD_LABELS, type FilmData, type FilmMethod } from './data';
import { EXAMPLE_PLASMON, exampleFilmSpectrum, examplePlasmonSpectrum } from './example';

const METHOD_HELP: Record<FilmMethod, string> = {
  plasmon:
    'For metal nanoparticles (for example gold or silver) in suspension or a film: fits the surface plasmon band on the photon energy axis to give its position and width. Load an absorbance or transmittance spectrum.',
  swanepoel:
    'For a uniform, transparent thin film on a thick transparent substrate (for example glass): uses the interference fringes in the transmittance to find the refractive index and the thickness. Load a transmittance spectrum with several fringes.',
};

/** Film wizard step 1: the method and one spectrum. */
export function FilmUploadStep({ data, update }: StepContext<FilmData>) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setBusy(true);
    const result = await importSpectra({ kind: 'file', file });
    setBusy(false);
    if (!result.ok) {
      setProblem(`${file.name}: ${result.error}`);
      return;
    }
    const first = result.spectra[0];
    if (!first) return;
    setProblem(
      result.spectra.length > 1
        ? `${file.name} holds ${result.spectra.length} spectra; the first, ${first.name}, is used.`
        : null,
    );
    update({
      spectrum: { ...first, id: crypto.randomUUID() },
      plasmon: { ...data.plasmon, result: null },
    });
  };

  const loadExample = () => {
    setProblem(null);
    if (data.method === 'plasmon') {
      update({
        ...initialFilmData,
        method: 'plasmon',
        spectrum: examplePlasmonSpectrum(),
        plasmon: {
          ...initialFilmData.plasmon,
          fromNm: 400,
          toNm: 750,
          centresNm: [Math.round(wavelengthFromEnergy(EXAMPLE_PLASMON.centerEv))],
        },
      });
    } else {
      update({
        ...initialFilmData,
        method: 'swanepoel',
        spectrum: exampleFilmSpectrum(),
        swanepoel: { ...initialFilmData.swanepoel, substrateIndex: 1.51 },
      });
    }
  };

  const s = data.spectrum;
  const notReady = s ? uploadProblem(data) : null;
  return (
    <div class="upload-step">
      <fieldset class="method-choice">
        <legend>Method</legend>
        {(Object.keys(METHOD_LABELS) as FilmMethod[]).map((m) => (
          <label key={m} class="check">
            <input
              type="radio"
              name="film-method"
              checked={data.method === m}
              onChange={() => update({ method: m })}
            />
            {METHOD_LABELS[m]}
          </label>
        ))}
      </fieldset>
      <p class="field-hint">{METHOD_HELP[data.method]}</p>
      <FileDrop
        formats=".txt, .csv or .dat with wavelength (nm) and absorbance or transmittance. Files stay on your device."
        onFiles={(files) => void load(files)}
        compact={s !== null}
      />
      <div class="upload-actions">
        <button type="button" class="btn" onClick={loadExample}>
          Try with example data
        </button>
        <span class="field-hint">
          Loads a synthetic spectrum with a known answer. Not a real measurement.
        </span>
      </div>
      <p class="upload-status" role="status">
        {busy ? 'Reading the file…' : ''}
      </p>
      {problem && (
        <p class="message is-warning" role="alert">
          {problem}
        </p>
      )}
      {s && (
        <p class="field-hint">
          Loaded: <strong>{s.name}</strong>, {s.kind}, {s.wavelengthNm.length} points from{' '}
          {s.wavelengthNm[0]?.toFixed(0)} to {s.wavelengthNm[s.wavelengthNm.length - 1]?.toFixed(0)}{' '}
          nm{s.synthetic ? ' (synthetic example)' : ''}.
        </p>
      )}
      {notReady && (
        <p class="message is-error">
          <strong>Problem:</strong> {notReady}
        </p>
      )}
    </div>
  );
}
