import { ELEMENT_BY_SYMBOL } from '../../core/elements';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import type { Substitution } from '../../core/xrd/rietveld/structure';
import { Advanced } from '../../ui/Advanced';
import { HelpTip } from '../../ui/HelpTip';
import type { RietveldState } from './data';
import { NumberInput } from './NumberInput';

/** "co", "CO" or " Co " as "Co"; null when it is not an element symbol. */
export function elementSymbol(text: string): string | null {
  const t = text.trim();
  const symbol = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  return ELEMENT_BY_SYMBOL.has(symbol) ? symbol : null;
}

/** The substitutions of a phase that can be used: a known site and a valid element. */
export function validSubstitutions(
  phase: ReferencePhase,
  typed: readonly Substitution[] | undefined,
): Substitution[] {
  const labels = new Set(phase.structure?.atoms.map((a) => a.label));
  return (typed ?? []).flatMap((s) => {
    const element = elementSymbol(s.element);
    return element && labels.has(s.site) ? [{ ...s, element }] : [];
  });
}

interface Props {
  settings: RietveldState;
  set: (patch: Partial<RietveldState>) => void;
  phases: readonly ReferencePhase[];
}

/** Rietveld step, Advanced: a dopant on a site of a phase (shared-site substitution). */
export function SubstitutionPanel({ settings, set, phases }: Props) {
  const all = settings.substitutions ?? {};
  const withAtoms = phases.filter((p) => p.structure && !(settings.leBail ?? []).includes(p.id));
  const update = (id: string, list: Substitution[]) =>
    set({ substitutions: { ...all, [id]: list } });
  return (
    <Advanced id="rietveld-doping" title="Doping: a second element on a site">
      <p class="field-hint">
        For a doped material such as Zn₁₋ₓCoₓO: choose the site the dopant replaces and type the
        nominal fraction x. The dopant shares the site’s position and displacement, and x can be
        refined after the basic refinement has converged.{' '}
        <HelpTip term="shared-site substitution">
          <p>
            The site then scatters as (1 − x)·f(host) + x·f(dopant), as GSAS-II does with two atoms
            on one site whose fractions add up to the site occupancy. X-rays see only the total
            scattering of the site: they cannot tell a dopant from vacancies, and neighbouring
            elements (for example Co and Zn, Fe and Mn) are hardly distinguishable, so keep x fixed
            at the nominal value for those. Weight fractions use the refined composition.
          </p>
        </HelpTip>
      </p>
      {withAtoms.length === 0 && (
        <p class="field-hint">
          None of the phases refined has atom positions stored (or they are in Le Bail mode). Add a
          phase from its CIF or from COD to use this.
        </p>
      )}
      {withAtoms.map((phase) => {
        const list = all[phase.id] ?? [];
        const atoms = phase.structure?.atoms ?? [];
        return (
          <fieldset key={phase.id} class="method-choice">
            <legend>{phase.name}</legend>
            {list.map((sub, i) => {
              const replace = (patch: Partial<Substitution>) =>
                update(
                  phase.id,
                  list.map((s, j) => (j === i ? { ...s, ...patch } : s)),
                );
              const symbolOk = elementSymbol(sub.element) !== null;
              return (
                <div key={i} class="radiation-fields">
                  <label class="inline-field">
                    Site
                    <select
                      value={sub.site}
                      onChange={(e) => replace({ site: e.currentTarget.value })}
                    >
                      {atoms.map((a) => (
                        <option key={a.label} value={a.label}>
                          {a.label} ({a.element})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="inline-field">
                    Dopant element
                    <input
                      value={sub.element}
                      placeholder="for example Co"
                      aria-invalid={!symbolOk}
                      onInput={(e) => replace({ element: e.currentTarget.value })}
                    />
                  </label>
                  <NumberInput
                    label="Fraction x on the site"
                    value={sub.fraction}
                    min={0}
                    max={1}
                    onChange={(v) => v !== null && replace({ fraction: v })}
                  />
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={sub.refine}
                      onChange={(e) => replace({ refine: e.currentTarget.checked })}
                    />
                    Refine x
                  </label>
                  <button
                    type="button"
                    class="btn btn-quiet"
                    onClick={() =>
                      update(
                        phase.id,
                        list.filter((_, j) => j !== i),
                      )
                    }
                  >
                    Remove
                  </button>
                  {!symbolOk && sub.element.trim() !== '' && (
                    <p class="field-hint">“{sub.element}” is not an element symbol.</p>
                  )}
                </div>
              );
            })}
            {atoms.length > list.length && (
              <button
                type="button"
                class="btn"
                onClick={() => {
                  const free = atoms.find((a) => !list.some((s) => s.site === a.label));
                  if (free)
                    update(phase.id, [
                      ...list,
                      { site: free.label, element: '', fraction: 0.05, refine: true },
                    ]);
                }}
              >
                Add a dopant
              </button>
            )}
          </fieldset>
        );
      })}
    </Advanced>
  );
}
