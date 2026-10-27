import { ftirStore } from './ftirStore';
import { Wizard } from '../../ui/wizard/Wizard';
import '../xrd/xrd.css';
import { ftirSteps } from './steps';

export default function FtirTool() {
  return <Wizard title="FTIR analysis" steps={ftirSteps} store={ftirStore} />;
}
