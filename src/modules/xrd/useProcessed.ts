import { useEffect, useRef, useState } from 'preact/hooks';
import type { ProcessingResult, ProcessingSettings } from '../../core/xrd/process/pipeline';
import type { RadiationSettings } from '../../core/xrd/radiation';
import type { Pattern } from '../../core/xrd/types';
import { ProcessClient } from './processClient';

/**
 * The pattern after preprocessing, computed in a web worker whenever the pattern or the
 * settings change. `result` is null until the first result for this pattern arrives.
 */
export function useProcessed(
  pattern: Pattern | undefined,
  settings: ProcessingSettings,
  radiation: RadiationSettings,
): { result: ProcessingResult | null; busy: boolean } {
  const [state, setState] = useState<{ patternId: string; result: ProcessingResult | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const client = useRef<ProcessClient | null>(null);
  const requested = useRef<string | null>(null);

  useEffect(() => {
    client.current = new ProcessClient((result) => {
      if (requested.current) setState({ patternId: requested.current, result });
      setBusy(false);
    });
    return () => client.current?.dispose();
  }, []);

  useEffect(() => {
    if (!pattern) return;
    requested.current = pattern.id;
    setBusy(true);
    client.current?.request({
      twoTheta: pattern.twoTheta,
      intensity: pattern.intensity,
      settings,
      radiation,
    });
  }, [pattern, settings, radiation]);

  // A result computed for another pattern is never shown for this one.
  return { result: state && pattern && state.patternId === pattern.id ? state.result : null, busy };
}
