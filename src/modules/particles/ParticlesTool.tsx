import { Wizard } from '../../ui/wizard/Wizard';
import '../../ui/plot/plot.css';
import '../xrd/xrd.css';
import { particleStore } from './particleStore';
import { particleSteps } from './steps';

export default function ParticlesTool() {
  return <Wizard title="Particle size from images" steps={particleSteps} store={particleStore} />;
}
