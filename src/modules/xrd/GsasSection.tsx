import {
  instprm,
  phaseCif,
  refinedStructure,
  tchExact,
  tchFromPseudoVoigt,
} from '../../core/xrd/export/gsas';
import { ANODES } from '../../core/xrd/radiation';
import { phaseReference } from '../../core/xrd/reference/source';
import type { ReferencePhase, StoredStructure } from '../../core/xrd/reference/types';
import type { RietveldPhaseResult } from '../../core/xrd/rietveld/refine';
import { HelpTip } from '../../ui/HelpTip';
import { downloadBlob, fileStem } from '../../ui/plot/export';
import { processingFor, type XrdData } from './data';

const save = (text: string, name: string) =>
  downloadBlob(new Blob([text], { type: 'text/plain' }), name);

const axialOf = (result: { axial?: { value: number } }) => result.axial?.value ?? 0;

const microns = (size: { value: number } | null) =>
  size && Number.isFinite(size.value) ? (size.value / 1000).toPrecision(5) : 'not determined';

/** One comment line with a phase's refined size and microstrain in GSAS-II's terms. */
function sampleComment(p: RietveldPhaseResult): string {
  const size =
    p.sizeModel === 'uniaxial' && p.sizeAxial
      ? `uniaxial size along [${(p.sizeAxis ?? [0, 0, 1]).join(' ')}]: equatorial ${microns(p.size)} um, axial ${microns(p.sizeAxial)} um`
      : `isotropic size ${microns(p.size)} um`;
  const strain = p.stephens
    ? `generalized microstrain ${p.stephens.map((s) => `${s.name} ${s.value.value.toPrecision(5)}`).join(', ')}`
    : p.strainModel === 'uniaxial' && p.microstrainAxial
      ? `uniaxial microstrain along [${(p.strainAxis ?? [0, 0, 1]).join(' ')}]: equatorial ${p.microstrain ? p.microstrain.value.toPrecision(5) : 0}, axial ${p.microstrainAxial.value.toPrecision(5)}`
      : `isotropic microstrain ${p.microstrain ? p.microstrain.value.toPrecision(5) : 0}`;
  return `${p.name}: ${size}, ${strain}, refined here with LGmix ${p.sizeMix.value.toFixed(3)}, ${p.strainMix.value.toFixed(3)} (enter them in the phase's Data tab in GSAS-II).`;
}

/** Whether SH/L in the file was refined here. */
function axialNote(result: { axial?: { value: number; refined: boolean } }): string {
  return result.axial && result.axial.value > 0
    ? `SH/L ${result.axial.value.toPrecision(5)} ${result.axial.refined ? 'refined here' : 'from the fixed instrument profile'} (the same Finger-Cox-Jephcoat profile).`
    : "SH/L is GSAS-II's default, not refined here.";
}

/** Export step: GSAS-II starting set (instrument parameters and a CIF per phase). */
export function GsasSection({ data, phases }: { data: XrdData; phases: ReferencePhase[] }) {
  const settings = data.rietveld;
  const result = settings.result?.outcome.ok === true ? settings.result.outcome : null;
  const lines = ANODES[data.radiation.anode];
  const pattern = data.patterns.find((p) => p.id === settings.patternId) ?? data.patterns[0];
  const cleaning = pattern ? processingFor(data, pattern.id) : null;
  const ratio =
    data.radiation.kAlpha1Only || ((settings.useCleaned ?? true) && cleaning?.kAlpha2.enabled)
      ? 0
      : data.radiation.kAlpha2Ratio;
  const first = result?.phases[0];

  const instrument = () => {
    if (!result || !first) return;
    const from = result.x[0] as number;
    const to = result.x[result.x.length - 1] as number;
    const profile = first.tch
      ? tchExact({
          u: first.u.value,
          v: first.v.value,
          w: first.w.value,
          x: first.x.value,
          y: first.y.value,
        })
      : tchFromPseudoVoigt(
          { u: first.u.value, v: first.v.value, w: first.w.value, eta: first.eta.value },
          from,
          to,
        );
    save(
      instprm({
        kAlpha1: lines.kAlpha1,
        kAlpha2: lines.kAlpha2,
        ratio,
        zero: result.zero.value,
        polarisation: result.polarisation ?? 0.5,
        profile,
        shl: axialOf(result),
        comments: [
          ...result.phases.flatMap((p) =>
            p.size || p.microstrain || p.stephens ? [sampleComment(p)] : [],
          ),
          ...(first.tch
            ? [
                `Profile of ${first.name} from the Rietveld step, refined with the same Thompson-Cox-Hastings shape (exact). ${axialNote(result)}`,
              ]
            : [
                `Profile of ${first.name} from the Rietveld step (${from.toFixed(2)}-${to.toFixed(2)} deg 2theta), converted to the Thompson-Cox-Hastings form`,
                `Largest difference over that range: FWHM ${(100 * profile.fwhmError).toFixed(2)} %, eta ${profile.etaError.toFixed(3)}. ${axialNote(result)} Choose the GSAS-II peak shape in the Rietveld step for an exact file.`,
              ]),
          'A starting point: refine the instrument and profile in GSAS-II.',
        ],
      }),
      `${fileStem(pattern?.name ?? 'xrd')}.instprm`,
    );
  };

  const withStructure = phases.filter((p) => p.structure);
  return (
    <section aria-labelledby="gsas-title">
      <h3 id="gsas-title" class="export-title">
        GSAS-II starting set
      </h3>
      <p class="field-hint">
        Optional. Your analysis is already finished on this site; these files are only for a
        reviewer who wants it checked or continued in GSAS-II. Load the measured .xye above as the
        powder data with this .instprm file, then add each phase from its CIF.{' '}
        <HelpTip term="GSAS-II starting set">
          <p>
            GSAS-II describes the peak shape with separate Gaussian (U, V, W) and Lorentzian (X, Y)
            widths, while this site uses one width and a mixing η. The file holds the closest
            GSAS-II values over your 2θ range, with the size of the difference written at the top.
            The CIFs hold the refined cell and, when the structure was refined, the refined atoms.
            Refine again in GSAS-II rather than treating the files as a finished refinement.
          </p>
        </HelpTip>
      </p>
      <div class="export-actions">
        <button type="button" class="btn" disabled={!first} onClick={instrument}>
          Instrument parameters (.instprm)
        </button>
        {withStructure.map((phase) => {
          const fit = result?.phases.find((r) => r.id === phase.id);
          return (
            <button
              key={phase.id}
              type="button"
              class="btn"
              onClick={() =>
                save(
                  phaseCif({
                    name: phase.name,
                    formula: phase.formula,
                    spaceGroup: phase.spaceGroup,
                    cell: fit
                      ? {
                          a: fit.cell.a.value,
                          b: fit.cell.b.value,
                          c: fit.cell.c.value,
                          alpha: fit.cell.alpha.value,
                          beta: fit.cell.beta.value,
                          gamma: fit.cell.gamma.value,
                        }
                      : phase.cell,
                    structure: refinedStructure(phase.structure as StoredStructure, fit),
                    comments: [
                      `Written by Plot Bhai from ${phaseReference(phase)}`,
                      fit
                        ? `Cell${fit.atoms ? ' and atoms' : ''} from the Rietveld step (estimates)`
                        : 'Cell and atoms as in the reference',
                    ],
                  }),
                  `${fileStem(phase.name)}.cif`,
                )
              }
            >
              {phase.name} (.cif)
            </button>
          );
        })}
      </div>
      {!first && (
        <p class="field-hint">
          The instrument file needs a Rietveld refinement (step 5), which gives the peak shape.
        </p>
      )}
      {phases.length > withStructure.length && (
        <p class="field-hint">
          Some phases have no stored atoms (older session): add them again from their CIF to export
          them.
        </p>
      )}
    </section>
  );
}
