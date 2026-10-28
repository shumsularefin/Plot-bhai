import { useMemo } from 'preact/hooks';
import { MIN_INTERCEPTS, type InterceptStructure } from '../../core/particles/stereology';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { NumberInput } from '../xrd/NumberInput';
import type { ParticleData, StereologySettings } from './data';
import { stereologyOf } from './stereology';

const fmt = (value: number | null, digits = 4) =>
  value !== null && Number.isFinite(value) ? String(Number(value.toPrecision(digits))) : '–';

const STRUCTURES: [InterceptStructure, string][] = [
  ['phase', 'Particles or one phase on a background'],
  ['grains', 'Grains that fill the image (single phase)'],
];

interface Props extends StepContext<ParticleData> {
  /** Mean and median particle size of the distribution in nm, or null without a scale. */
  particleNm: { mean: number; median: number; measure: string } | null;
  stem: string;
}

/**
 * Area fraction, mean lineal intercept (ASTM E112) and a side-by-side table of the particle size
 * and an XRD crystallite size, for the image on screen.
 */
export function StereologySection({ data, update, particleNm, stem }: Props) {
  const st = data.stereology;
  const set = (patch: Partial<StereologySettings>) => update({ stereology: { ...st, ...patch } });
  const result = useMemo(() => stereologyOf(data), [data]);
  const ratio =
    particleNm && st.xrdSizeNm !== null && st.xrdSizeNm > 0 ? particleNm.mean / st.xrdSizeNm : null;
  const anisotropy =
    result && result.meanHorizontal !== null && result.meanVertical !== null
      ? result.meanHorizontal / result.meanVertical
      : null;
  const xrdMethod = st.xrdMethod.trim() || 'XRD';

  const download = () => {
    if (!result) return;
    const u = result.unit;
    const rows: [string, number | string, string][] = [
      ['Regions counted', result.regions, ''],
      ['Area fraction', result.areaFraction * 100, '%'],
      ['Test lines per direction', result.horizontal.lines, ''],
      ['Intercepts, horizontal lines', result.horizontal.intercepts, ''],
      ['Intercepts, vertical lines', result.vertical.intercepts, ''],
      ['Mean lineal intercept, horizontal', result.meanHorizontal ?? '', u],
      ['Mean lineal intercept, vertical', result.meanVertical ?? '', u],
      ['Mean lineal intercept, both', result.mean ?? '', u],
      ['ASTM E112 grain size number G', result.astmG ?? '', ''],
    ];
    if (particleNm && st.xrdSizeNm !== null) {
      rows.push(
        [`Particle size, mean ${particleNm.measure}`, particleNm.mean, 'nm'],
        [`Crystallite size (${xrdMethod})`, st.xrdSizeNm, 'nm'],
        ['Ratio particle / crystallite', ratio ?? '', ''],
      );
    }
    downloadCsv(
      `${stem}-area-fraction-intercepts`,
      `Area fraction and mean lineal intercept (ASTM E112-13) of the detected regions; structure: ${st.structure === 'grains' ? 'grains filling the image, l = L/N' : 'one phase, l = L_alpha/N_alpha'}. Intercepts at line ends count one half.`,
      rows,
      [
        { header: 'Quantity', value: (r) => r[0] },
        { header: 'Value', value: (r) => r[1] },
        { header: 'Unit', value: (r) => r[2] },
      ],
    );
  };

  return (
    <section aria-labelledby="dist-stereology">
      <h3 id="dist-stereology" class="export-title">
        Area fraction and grain size{' '}
        <HelpTip term="area fraction and line intercepts">
          <p>
            The area fraction is the share of the analysis area covered by the detected regions. In
            a random section it estimates the volume fraction of that phase (Delesse principle); if
            you detected pores, it is the porosity seen in the image.
          </p>
          <p>
            For the intercept method (ASTM E112, Heyn), evenly spaced horizontal and vertical test
            lines cross the image. Every region a line crosses is one intercept; a region at the end
            of a line counts one half. For grains that fill the image the mean lineal intercept is
            the line length divided by the intercepts. For one phase on a background it is the
            length of line inside that phase divided by its intercepts (the mean chord length).
          </p>
        </HelpTip>
      </h3>
      {!result ? (
        <p class="field-hint">
          Detect particles in step 3 to get the area fraction and the line intercepts of this image.
        </p>
      ) : (
        <>
          <fieldset class="method-choice">
            <legend>The detected regions are</legend>
            {STRUCTURES.map(([structure, name]) => (
              <label key={structure} class="check">
                <input
                  type="radio"
                  name="particle-structure"
                  checked={st.structure === structure}
                  onChange={() => set({ structure })}
                />
                {name}
              </label>
            ))}
          </fieldset>
          <div class="radiation-fields">
            <NumberInput
              label="Test lines in each direction"
              value={st.lines}
              min={0}
              max={500}
              step={1}
              onChange={(v) => v !== null && v >= 1 && set({ lines: Math.round(v) })}
            />
          </div>
          <div
            class="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Area fraction and intercepts, scrolls sideways"
          >
            <table class="peak-table">
              <thead>
                <tr>
                  <th scope="col">Area fraction (%)</th>
                  <th scope="col">Intercepts</th>
                  <th scope="col">ℓ̄ horizontal ({result.unit})</th>
                  <th scope="col">ℓ̄ vertical ({result.unit})</th>
                  <th scope="col">ℓ̄ both ({result.unit})</th>
                  <th scope="col">ASTM G</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{fmt(result.areaFraction * 100, 3)}</td>
                  <td>{fmt(result.intercepts, 6)}</td>
                  <td>{fmt(result.meanHorizontal)}</td>
                  <td>{fmt(result.meanVertical)}</td>
                  <td>{fmt(result.mean)}</td>
                  <td>{result.astmG === null ? '–' : result.astmG.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="field-hint">
            {result.regions} regions in the analysis area, including those cut by its edge. The size
            and shape filters of step 3 apply.
          </p>
          {result.intercepts < MIN_INTERCEPTS && (
            <p class="message is-warning">
              <strong>Check:</strong> only {fmt(result.intercepts, 4)} intercepts. ASTM E112 asks
              for at least {MIN_INTERCEPTS}; add test lines or images, or treat ℓ̄ as rough.
            </p>
          )}
          {anisotropy !== null && (anisotropy > 1.25 || anisotropy < 0.8) && (
            <p class="message is-info">
              The horizontal and vertical intercepts differ (ratio {fmt(anisotropy, 3)}), so the
              regions look elongated in one direction. Report both, not only the mean.
            </p>
          )}
          {result.unit === 'px' && (
            <p class="field-hint">Set the scale in step 2 to get lengths in nm and ASTM G.</p>
          )}
          {result.astmG !== null && (
            <p class="field-hint">
              G = −6.643856 log₁₀ ℓ̄ − 3.288 with ℓ̄ in mm (ASTM E112-13, Table 6). It is defined for
              metallographic grain structures; for nanoparticles ℓ̄ in nm is usually the more useful
              number.
            </p>
          )}

          <h4 class="export-title">
            Compare with the XRD crystallite size{' '}
            <HelpTip term="particle size and crystallite size">
              <p>
                XRD (Scherrer, Williamson–Hall and similar) measures the size of coherently
                diffracting domains, weighted by volume. The microscope measures whole particles,
                counted by number. A particle can hold one crystallite or many, so the two numbers
                answer different questions.
              </p>
            </HelpTip>
          </h4>
          {!particleNm ? (
            <p class="field-hint">Set the scale in step 2 to compare with XRD.</p>
          ) : (
            <>
              <div class="radiation-fields">
                <NumberInput
                  label="Crystallite size from XRD (nm)"
                  value={st.xrdSizeNm}
                  min={0}
                  onChange={(xrdSizeNm) => set({ xrdSizeNm })}
                />
                <label class="inline-field">
                  XRD method
                  <input
                    type="text"
                    value={st.xrdMethod}
                    placeholder="for example Scherrer"
                    onInput={(e) => set({ xrdMethod: e.currentTarget.value })}
                  />
                </label>
              </div>
              {st.xrdSizeNm !== null && ratio !== null && (
                <>
                  <div
                    class="table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="Particle and crystallite size, scrolls sideways"
                  >
                    <table class="peak-table">
                      <thead>
                        <tr>
                          <th scope="col">Particle mean (nm)</th>
                          <th scope="col">Particle median (nm)</th>
                          <th scope="col">Crystallite, {xrdMethod} (nm)</th>
                          <th scope="col">Particle / crystallite</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{fmt(particleNm.mean)}</td>
                          <td>{fmt(particleNm.median)}</td>
                          <td>{fmt(st.xrdSizeNm)}</td>
                          <td>{fmt(ratio, 3)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p class="message is-info" role="note">
                    <strong>Estimate, not a proof:</strong>{' '}
                    {ratio < 1
                      ? 'the particles look smaller than the crystallites. Check the scale, the detection and the XRD size; this is not expected.'
                      : `a ratio close to 1 fits particles that are each one crystallite; a ratio clearly above 1 fits particles made of several crystallites or aggregates. Here it is ${fmt(ratio, 3)}. Electron diffraction or high-resolution TEM can tell.`}
                  </p>
                </>
              )}
            </>
          )}
          <div class="export-actions">
            <button type="button" class="btn" onClick={download}>
              Area fraction and intercepts (CSV)
            </button>
          </div>
        </>
      )}
    </section>
  );
}
