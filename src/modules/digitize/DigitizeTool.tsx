import { useMemo } from 'preact/hooks';
import { createPersistedStore, type PersistedStore } from '../../ui/persist/persistedStore';
import { initialWizardState, type WizardState } from '../../ui/wizard/types';
import { Wizard } from '../../ui/wizard/Wizard';
import '../../ui/plot/plot.css';
import '../xrd/xrd.css';
import { initialShotData, SHOT_STATE_VERSION, type ShotData } from './data';
import './shot.css';
import { digitizeSteps } from './steps';
import { TargetProvider, type DigitizeTarget } from './target';

/** One saved reader per tool, so a half-traced FTIR figure does not replace an XRD one. */
const stores = new Map<string, PersistedStore<WizardState<ShotData>>>();

function storeFor(key: string) {
  let store = stores.get(key);
  if (!store) {
    store = createPersistedStore({
      key,
      version: SHOT_STATE_VERSION,
      initial: initialWizardState(initialShotData),
    });
    stores.set(key, store);
  }
  return store;
}

/** The graph-image reader, opened from a tool's upload step; the curve goes back to that tool. */
export function DigitizeTool({ target }: { target: DigitizeTarget }) {
  const steps = useMemo(() => digitizeSteps(target), [target]);
  return (
    <TargetProvider value={target}>
      <p class="back-link">
        <a href={target.route}>← Back to {target.tool} analysis</a>
      </p>
      <Wizard
        title={`${target.tool}: data from a graph image`}
        steps={steps}
        store={storeFor(target.storeKey)}
      />
    </TargetProvider>
  );
}
