import { useState } from 'preact/hooks';
import { LazyTool } from '../../ui/LazyTool';
import { savedTechnique, saveTechnique, type Technique } from './technique';
import { tgaStore } from './tgaStore';
import { ToolModeContext } from '../../ui/wizard/ToolMode';
import { Wizard } from '../../ui/wizard/Wizard';
import '../xrd/xrd.css';
import { thermalSteps } from './steps';
import './thermal.css';

// Defined once at module level so LazyTool does not reload it on every render.
const loadDsc = () => import('./dsc/DscTool');
const loadKinetics = () => import('./kinetics/KineticsTool');
const loadDscMethods = () => import('./dscMethods/DscMethodsTool');

const TECHNIQUES = [
  { id: 'tga', label: 'TGA (mass loss)' },
  { id: 'dsc', label: 'DSC (heat flow)' },
  { id: 'dsc-methods', label: 'DSC: Cp, purity, OIT' },
  { id: 'kinetics', label: 'Kinetics (several heating rates)' },
] as const;

/** TGA, DSC, the DSC special methods and kinetics are separate wizards; the choice is remembered. Each keeps its own saved session. */
export default function ThermalTool() {
  const [technique, setTechnique] = useState<Technique>(savedTechnique);
  const choose = (next: Technique) => {
    setTechnique(next);
    saveTechnique(next);
  };
  return (
    <ToolModeContext.Provider
      value={{
        label: 'Technique',
        value: technique,
        options: TECHNIQUES,
        onChange: (id) => choose(id as Technique),
      }}
    >
      {technique === 'dsc' ? (
        <LazyTool load={loadDsc} />
      ) : technique === 'dsc-methods' ? (
        <LazyTool load={loadDscMethods} />
      ) : technique === 'kinetics' ? (
        <LazyTool load={loadKinetics} />
      ) : (
        <Wizard title="TGA analysis" steps={thermalSteps} store={tgaStore} />
      )}
    </ToolModeContext.Provider>
  );
}
