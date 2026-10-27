import { Wizard } from '../../ui/wizard/Wizard';
import { xrdSteps } from './steps';
import { xrdStore } from './xrdStore';
import './xrd.css';

export default function XrdTool() {
  return <Wizard title="XRD analysis" steps={xrdSteps} store={xrdStore} />;
}
