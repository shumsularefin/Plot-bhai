import { uvvisStore } from './uvvisStore';
import { Wizard } from '../../ui/wizard/Wizard';
import '../xrd/xrd.css';
import { uvvisSteps } from './steps';

export default function UvvisTool() {
  return <Wizard title="UV-Vis analysis" steps={uvvisSteps} store={uvvisStore} />;
}
