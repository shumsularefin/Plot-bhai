import { useMemo } from 'preact/hooks';
import type { FtirProcessed } from '../../core/ftir/process';
import type { FtirSpectrum } from '../../core/ftir/types';
import type { StepContext } from '../../ui/wizard/types';
import { processAll } from './analysis';
import { BandAreaSection } from './BandAreaSection';
import { BandFitSection } from './BandFitSection';
import { bandsFor, type BandSettings, type FtirData } from './data';
import { DerivativeSection } from './DerivativeSection';
import { SubtractSection } from './SubtractSection';
import { useSelectedSpectrum } from './useSelected';

/** What every section of the Bands step works on. */
export interface BandContext extends StepContext<FtirData> {
  spectrum: FtirSpectrum;
  processed: FtirProcessed;
  /** Processed spectra in the order of data.spectra. */
  all: readonly FtirProcessed[];
  settings: BandSettings;
  /** Merges a patch into one or more parts of the settings. */
  set: (patch: { [K in keyof BandSettings]?: Partial<BandSettings[K]> }) => void;
  select: (id: string) => void;
}

/**
 * Wizard step 4: spectrum subtraction, second derivative, band fitting and band areas of the
 * selected spectrum, all on the processed absorbance of step 2.
 */
export function BandsStep(context: StepContext<FtirData>) {
  const { data, update } = context;
  const { spectrum, select } = useSelectedSpectrum(data.spectra);
  const all = useMemo(
    () => processAll(data.spectra, data.processing),
    [data.spectra, data.processing],
  );
  const processed = spectrum ? all[data.spectra.indexOf(spectrum)] : undefined;
  if (!spectrum || !processed) return <p>No spectra are loaded. Go back to Upload to add one.</p>;
  const settings = bandsFor(data, spectrum.id);
  const set: BandContext['set'] = (patch) =>
    update({
      bands: {
        ...data.bands,
        [spectrum.id]: {
          derivative: { ...settings.derivative, ...patch.derivative },
          fit: { ...settings.fit, ...patch.fit },
          areas: { ...settings.areas, ...patch.areas },
          subtract: { ...settings.subtract, ...patch.subtract },
        },
      },
    });
  const band: BandContext = { ...context, spectrum, processed, all, settings, set, select };

  return (
    <div class="clean-step">
      {data.spectra.length > 1 && (
        <div class="clean-toolbar">
          <label class="inline-field">
            Spectrum
            <select value={spectrum.id} onChange={(e) => select(e.currentTarget.value)}>
              {data.spectra.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p class="field-hint">
        Every section is optional and works on the absorbance after the processing of step 2. Use
        only what your analysis needs, then press Next.
      </p>
      <SubtractSection {...band} />
      <DerivativeSection {...band} />
      <BandFitSection {...band} />
      <BandAreaSection {...band} />
    </div>
  );
}
