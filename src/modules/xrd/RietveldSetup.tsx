import { useRef, useState } from 'preact/hooks';
import { readInstprm } from '../../core/xrd/export/gsas';
import type { InstrumentProfile, RietveldResult } from '../../core/xrd/rietveld/refine';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import { Advanced } from '../../ui/Advanced';
import { HelpTip } from '../../ui/HelpTip';
import { DEFAULT_OPTICS, type MonochromatorChoice, type RietveldState } from './data';
import { NumberInput } from './NumberInput';
import { monochromatorAngle, parseRanges, polarisationOf } from './rietveldSettings';

const MONOCHROMATOR_LABELS: [MonochromatorChoice, string][] = [
  ['none', 'None (filter or detector discrimination only)'],
  ['graphite', 'Graphite (002), diffracted beam'],
  ['germanium', 'Germanium (111), incident beam (Kα1 only)'],
  ['custom', 'Other: type the polarisation coefficient'],
];

const PROFILE_KEYS: [keyof InstrumentProfile, string][] = [
  ['u', 'U (deg²)'],
  ['v', 'V (deg²)'],
  ['w', 'W (deg²)'],
  ['x', 'X (deg)'],
  ['y', 'Y (deg)'],
  ['shl', 'SH/L (axial divergence)'],
];

const ZERO_PROFILE: InstrumentProfile = { u: 0, v: 0, w: 0.001, x: 0, y: 0 };

interface Props {
  settings: RietveldState;
  set: (patch: Partial<RietveldState>) => void;
  /** Phases being refined (for the internal standard). */
  phases: readonly ReferencePhase[];
  /** Kα1 wavelength, Å. */
  lambda: number;
  /** Last result, to take its widths as the instrument profile. */
  result: RietveldResult | null;
  patternName: string;
}

/** Rietveld step, Advanced: optics, instrument profile, excluded ranges and internal standard. */
export function RietveldSetup({ settings, set, phases, lambda, result, patternName }: Props) {
  const optics = settings.optics ?? DEFAULT_OPTICS;
  const instrument = settings.instrument ?? null;
  const standard = settings.standard ?? null;
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const angle = monochromatorAngle(optics, lambda);
  const rangesText = settings.excludedRanges ?? '';
  const rangesOk = parseRanges(rangesText) !== null;
  const first = result?.phases[0];

  /** The last refinement's TCH widths, when it had them and no sample broadening. */
  const lastWidths = () =>
    first?.tch && !first.size && !first.microstrain
      ? {
          profile: {
            u: first.u.value,
            v: first.v.value,
            w: first.w.value,
            x: first.x.value,
            y: first.y.value,
            shl: result?.axial?.value ?? 0,
          },
          source: `the refinement of ${first.name} in ${patternName}`,
        }
      : null;

  const loadInstprm = async (file: File) => {
    const read = readInstprm(await file.text());
    if ('error' in read) {
      setFileNote(read.error);
      return;
    }
    set({
      instrument: { profile: read.profile, source: `GSAS-II file ${file.name}` },
      ...(read.polarisation !== 0.5 && {
        optics: { ...optics, monochromator: 'custom', polarisation: read.polarisation },
      }),
    });
    setFileNote(
      [
        `Loaded U, V, W, X, Y, SH/L${read.polarisation !== 0.5 ? ` and the polarisation coefficient ${read.polarisation}` : ''} from ${file.name}.`,
        ...(read.kAlpha1 !== null && Math.abs(read.kAlpha1 - lambda) > 1e-4
          ? [
              `Its wavelength (${read.kAlpha1} Å) is not the one set for this pattern (${lambda} Å); check the radiation in step 1.`,
            ]
          : []),
        ...read.notes,
      ].join(' '),
    );
  };

  return (
    <Advanced id="rietveld-instrument" title="Instrument, sample and quantification">
      <fieldset class="method-choice">
        <legend>
          Monochromator{' '}
          <HelpTip term="monochromator polarisation">
            <p>
              A crystal monochromator polarises the beam, which changes the relative intensities
              (the polarisation part of the Lorentz–polarisation factor). Choose the one on your
              instrument; with only a Kβ filter or a detector that discriminates energy, choose
              None. The polarisation coefficient P is GSAS-II’s “Polariz.” (0.5 is no monochromator)
              and is written to the GSAS-II instrument file.
            </p>
          </HelpTip>
        </legend>
        <select
          aria-label="Monochromator"
          value={optics.monochromator}
          onChange={(e) =>
            set({
              optics: { ...optics, monochromator: e.currentTarget.value as MonochromatorChoice },
            })
          }
        >
          {MONOCHROMATOR_LABELS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {optics.monochromator === 'custom' && (
          <NumberInput
            label="Polarisation coefficient P"
            value={optics.polarisation}
            min={0}
            max={1}
            onChange={(v) => v !== null && set({ optics: { ...optics, polarisation: v } })}
          />
        )}
        <p class="field-hint">
          P = {polarisationOf(optics, lambda).toFixed(4)}
          {angle !== null && ` (monochromator angle 2θ_m = ${angle.toFixed(2)}°)`}.
          {optics.monochromator === 'germanium' &&
            ' A germanium incident-beam monochromator removes Kα2: tick “Kα1 only” in step 1. P assumes an ideally perfect crystal, an approximation (dynamical calculations give a slightly smaller polarisation); if your manufacturer gives a measured value, choose Other and type it.'}
        </p>
        <label class="check">
          <input
            type="checkbox"
            checked={optics.variableSlit}
            onChange={(e) => set({ optics: { ...optics, variableSlit: e.currentTarget.checked } })}
          />
          Automatic (variable) divergence slit{' '}
          <HelpTip term="variable divergence slit">
            <p>
              Tick this when the data were measured with an automatic slit that keeps the irradiated
              length constant (often called ADS or “variable slit”) and were not converted to
              fixed-slit intensities. The calculated intensities are then multiplied by sin θ.
              Getting this wrong biases displacement parameters and occupancies.
            </p>
          </HelpTip>
        </label>
      </fieldset>

      <fieldset class="method-choice">
        <legend>
          Sample geometry{' '}
          <HelpTip term="sample geometry">
            <p>
              Flat plate: the usual reflection (Bragg–Brentano) geometry. Capillary: the powder is
              in a glass capillary in transmission (Debye–Scherrer). The capillary absorbs more of
              the beam scattered at low angle, so the intensities are multiplied by GSAS-II’s
              cylinder absorption factor A(μR, θ), with μR the linear absorption coefficient times
              the capillary radius. Off-axis capillary positions shift the peaks by Dx cos 2θ + Dy
              sin 2θ (the “Sample displacement” and “Sample transparency” choices then refine Dx and
              Dy).
            </p>
          </HelpTip>
        </legend>
        <label class="check">
          <input
            type="radio"
            name="rietveld-geometry"
            checked={!optics.capillary}
            onChange={() => set({ optics: { ...optics, capillary: false } })}
          />
          Flat plate (Bragg–Brentano)
        </label>
        <label class="check">
          <input
            type="radio"
            name="rietveld-geometry"
            checked={optics.capillary === true}
            onChange={() => set({ optics: { ...optics, capillary: true } })}
          />
          Capillary (Debye–Scherrer)
        </label>
        {optics.capillary && (
          <NumberInput
            label="μR (absorption × radius)"
            value={optics.muR ?? 0}
            min={0}
            max={20}
            onChange={(v) => v !== null && set({ optics: { ...optics, muR: v } })}
          />
        )}
        {optics.capillary && (
          <p class="field-hint">
            μR = μ·ρ_packing·R: μ the linear absorption coefficient of the compact material at this
            wavelength, ρ_packing the fraction of the capillary filled (often 0.4 to 0.6), R the
            inner radius. Tick “Capillary absorption μR” under “What to refine” to refine it.
          </p>
        )}
      </fieldset>

      <fieldset class="method-choice">
        <legend>
          Anomalous dispersion{' '}
          <HelpTip term="anomalous dispersion">
            <p>
              Near an absorption edge an atom scatters less (f′, negative) and with a phase shift
              (f″). For Cu radiation this matters most for Fe, Co, Mn and the rare earths. The
              values are Cromer–Liberman f′ and f″ computed by GSAS-II for the Kα1 wavelength of the
              anode chosen in step 1; GSAS-II always includes them, so tick this to match a GSAS-II
              refinement. It needs the atom positions of each phase (added from a CIF).
            </p>
          </HelpTip>
        </legend>
        <label class="check">
          <input
            type="checkbox"
            checked={optics.anomalous === true}
            onChange={(e) => set({ optics: { ...optics, anomalous: e.currentTarget.checked } })}
          />
          Include f′ and f″ in the structure factors
        </label>
      </fieldset>

      <fieldset class="method-choice">
        <legend>
          Instrument profile{' '}
          <HelpTip term="instrument profile">
            <p>
              Every diffractometer broadens the peaks. To measure the sample’s own crystallite size
              and microstrain, fix the instrument’s peak widths (U, V, W, X, Y of the GSAS-II peak
              shape) from a standard with large, unstrained crystals such as LaB₆ (NIST SRM 660) or
              Si: refine the standard here with the GSAS-II peak shape, then use its widths.
            </p>
          </HelpTip>
        </legend>
        <label class="check">
          <input
            type="radio"
            name="rietveld-instrument"
            checked={!instrument}
            onChange={() => set({ instrument: null })}
          />
          Refine the peak widths with the sample (no standard)
        </label>
        <label class="check">
          <input
            type="radio"
            name="rietveld-instrument"
            checked={instrument !== null}
            onChange={() =>
              set({
                instrument: instrument ??
                  lastWidths() ?? {
                    profile: ZERO_PROFILE,
                    source: 'typed values',
                  },
              })
            }
          />
          Fixed instrument profile (from a standard)
        </label>
        {instrument && (
          <>
            <div class="radiation-fields">
              {PROFILE_KEYS.map(([key, label]) => (
                <NumberInput
                  key={key}
                  label={label}
                  value={instrument.profile[key] ?? 0}
                  onChange={(v) =>
                    v !== null &&
                    set({
                      instrument: {
                        profile: { ...instrument.profile, [key]: v },
                        source: 'typed values',
                      },
                    })
                  }
                />
              ))}
            </div>
            <p class="field-hint">
              From {instrument.source}. Gaussian FWHM² = U tan²θ + V tanθ + W, Lorentzian FWHM =
              X/cos θ + Y tan θ (degrees 2θ). The GSAS-II peak shape is used.
            </p>
          </>
        )}
        <div class="export-actions">
          <button type="button" class="btn" onClick={() => fileInput.current?.click()}>
            Load a GSAS-II .instprm file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".instprm,.prm,text/plain"
            class="visually-hidden"
            aria-label="GSAS-II instrument parameter file to load"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) void loadInstprm(file);
            }}
          />
          {first?.tch && (
            <button
              type="button"
              class="btn"
              onClick={() => {
                set({
                  instrument: {
                    profile: {
                      u: first.u.value,
                      v: first.v.value,
                      w: first.w.value,
                      x: first.x.value,
                      y: first.y.value,
                    },
                    source: `the refinement of ${first.name} in ${patternName}`,
                  },
                });
                setFileNote(
                  `The widths of ${first.name} are now the instrument profile. Load your sample pattern (or choose it above) and refine it with crystallite size and microstrain.`,
                );
              }}
            >
              Use the last refined widths as the instrument profile
            </button>
          )}
        </div>
        {first?.tch && (first.size || first.microstrain) && (
          <p class="field-hint">
            The last refinement included size or strain, so its widths are not the instrument’s
            alone. Refine the standard without them before using its widths.
          </p>
        )}
        {fileNote && (
          <p class="field-hint" role="status">
            {fileNote}
          </p>
        )}
      </fieldset>

      <label class="inline-field">
        <span>
          Leave out 2θ ranges (°){' '}
          <HelpTip term="excluded regions">
            <p>
              Ranges the model should ignore, for example a peak of the sample holder, a detector
              artefact or an impurity you cannot identify. Type them as 38–39, 44.5–45.
            </p>
          </HelpTip>
        </span>
        <input
          value={rangesText}
          placeholder="for example 38–39, 44.5–45"
          aria-invalid={!rangesOk}
          onInput={(e) => set({ excludedRanges: e.currentTarget.value })}
        />
      </label>
      {!rangesOk && (
        <p class="field-hint">Type each range as two numbers with a dash, separated by commas.</p>
      )}

      <fieldset class="method-choice">
        <legend>
          Amorphous content (internal standard){' '}
          <HelpTip term="internal standard">
            <p>
              Mix a known weight of a crystalline standard (for example corundum, Si or ZnO) into
              the sample, include it as a phase here and type its weight percent in the mixture. The
              refinement then gives the amorphous and unidentified part of your original sample, and
              absolute weight fractions of its crystalline phases.
            </p>
          </HelpTip>
        </legend>
        <label class="inline-field">
          Standard phase
          <select
            value={standard?.phaseId ?? ''}
            onChange={(e) =>
              set({
                standard: e.currentTarget.value
                  ? { phaseId: e.currentTarget.value, percent: standard?.percent ?? null }
                  : null,
              })
            }
          >
            <option value="">No internal standard</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {standard && (
          <NumberInput
            label="Weighed standard (wt% of the mixture)"
            value={standard.percent}
            min={0}
            max={99.99}
            onChange={(v) => set({ standard: { ...standard, percent: v } })}
          />
        )}
      </fieldset>
    </Advanced>
  );
}
