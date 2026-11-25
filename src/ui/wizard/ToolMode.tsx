import { createContext } from 'preact';
import { useContext, useId } from 'preact/hooks';

/**
 * A tool with several separate analyses (TGA, DSC and kinetics; UV-Vis band gap, concentration
 * and thin film) offers the choice in the workbench header, next to the logo. Each analysis is
 * its own wizard, loaded lazily, so the choice reaches whichever wizard is showing through this
 * context rather than through props.
 */
export interface ToolMode {
  /** What is being chosen, for example "Technique". */
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (id: string) => void;
}

export const ToolModeContext = createContext<ToolMode | null>(null);

/** The header pop-up menu for the analysis in use; nothing for single-analysis tools. */
export function ToolModeSelect() {
  const mode = useContext(ToolModeContext);
  const id = useId();
  if (!mode) return null;
  return (
    <label class="tool-mode" for={id}>
      <span class="visually-hidden">{mode.label}</span>
      <select id={id} value={mode.value} onChange={(e) => mode.onChange(e.currentTarget.value)}>
        {mode.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
