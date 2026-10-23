import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_DETECTION, type DetectedPeak } from '../../core/xrd/peaks/detect';
import type { ProcessingResult } from '../../core/xrd/process/pipeline';
import type { Pattern } from '../../core/xrd/types';
import { peaksFor, processingFor, type XrdData } from './data';
import { PeaksClient } from './peaksClient';
import { useProcessed } from './useProcessed';

export interface Measured {
  pattern: Pattern | undefined;
  /** The pattern after the cleaning of step 2, or null while it is being computed. */
  processed: ProcessingResult | null;
  /** Peaks found on the cleaned pattern with the detection settings of step 5; null until found. */
  detected: DetectedPeak[] | null;
}

/** The chosen pattern after cleaning, and its detected peaks, both computed in web workers. */
export function useMeasured(data: XrdData, selectedId: string | undefined): Measured {
  const pattern = data.patterns.find((p) => p.id === selectedId) ?? data.patterns[0];
  const processing = processingFor(data, pattern?.id ?? '');
  const detection = pattern ? peaksFor(data, pattern.id).detection : DEFAULT_DETECTION;
  const { result: processed } = useProcessed(pattern, processing, data.radiation);
  const [found, setFound] = useState<{ source: ProcessingResult; peaks: DetectedPeak[] } | null>(
    null,
  );
  const client = useRef<PeaksClient | null>(null);
  useEffect(() => {
    client.current = new PeaksClient();
    return () => client.current?.dispose();
  }, []);
  useEffect(() => {
    if (!processed || !client.current) return;
    void client.current.detect(processed.twoTheta, processed.intensity, detection).then((peaks) => {
      if (peaks) setFound({ source: processed, peaks });
    });
  }, [processed, detection]);
  return {
    pattern,
    processed,
    // Peaks found for another pattern or older settings are not shown.
    detected: found && found.source === processed ? found.peaks : null,
  };
}
