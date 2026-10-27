import { dscStore } from './dscStore';
import { Wizard } from '../../../ui/wizard/Wizard';
import { dscSteps } from './steps';

export default function DscTool() {
  return <Wizard title="DSC analysis" steps={dscSteps} store={dscStore} />;
}
