import { countingSigma, patternXy, patternXye } from '../../core/xrd/patternFile';
import type { ProcessingResult } from '../../core/xrd/process/pipeline';
import { ANODES, type RadiationSettings } from '../../core/xrd/radiation';
import type { Pattern } from '../../core/xrd/types';
import { HelpTip } from '../../ui/HelpTip';
import { downloadBlob, fileStem } from '../../ui/plot/export';

const UNIT_ORIGIN: Record<Pattern['unitOrigin'], string> = {
  file: 'stated in the file',
  guess: 'guessed from the values',
  user: 'set by hand',
  generated: 'example data',
};

interface PatternFilesSectionProps {
  patterns: Pattern[];
  processed: Record<string, ProcessingResult | null>;
  radiation: RadiationSettings;
  /** True when the processed data were normalised, so they no longer carry the unit. */
  normalised: (patternId: string) => boolean;
}

/** Export step: each pattern as .xy and .xye text, as measured and as processed. */
export function PatternFilesSection({
  patterns,
  processed,
  radiation,
  normalised,
}: PatternFilesSectionProps) {
  const wavelengthA = ANODES[radiation.anode].kAlpha1;
  const save = (text: string, name: string) =>
    downloadBlob(new Blob([text], { type: 'text/plain' }), name);

  return (
    <section aria-labelledby="pattern-files-title">
      <h3 id="pattern-files-title" class="export-title">
        Pattern files
      </h3>
      <p class="field-hint">
        Each pattern as plain text for other programs such as GSAS-II, FullProf or Origin. The
        measured file holds the numbers as loaded; the processed file holds them after the steps
        chosen in Clean data. The header lines start with #.{' '}
        <HelpTip term=".xye">
          <p>
            A .xye file has a third column, σ: the standard uncertainty of each intensity, used to
            weight the points in a refinement. Detector counts follow Poisson statistics, so σ = √N
            for N counts (σ = 1 for a point with no counts, as GSAS-II does). For a count rate
            measured for t seconds per step, σ = √(rate × t) / t. σ is given for the measured data
            only: smoothing and background removal change the noise in a way one σ per point cannot
            describe.
          </p>
        </HelpTip>
      </p>
      <ul class="table-list">
        {patterns.map((pattern) => {
          const stem = fileStem(pattern.name);
          const unit = `${pattern.intensityUnit} (${UNIT_ORIGIN[pattern.unitOrigin]})`;
          const measuredHeader = [
            `Pattern: ${pattern.name}`,
            `Measured data as loaded (${pattern.source} file), written by Plot Bhai`,
            `Intensity unit: ${unit}`,
          ];
          const sigma = countingSigma(pattern);
          const result = processed[pattern.id];
          const processedUnit = normalised(pattern.id) ? 'normalised' : pattern.intensityUnit;
          return (
            <li key={pattern.id} class="pattern-files">
              <span class="pattern-files-name">{pattern.name}</span>
              <button
                type="button"
                class="btn"
                onClick={() =>
                  save(
                    patternXy(pattern.twoTheta, pattern.intensity, {
                      header: measuredHeader,
                      wavelengthA,
                      intensityLabel: `intensity (${pattern.intensityUnit})`,
                    }),
                    `${stem}-measured.xy`,
                  )
                }
              >
                Measured .xy
              </button>
              <button
                type="button"
                class="btn"
                disabled={!sigma.ok}
                aria-describedby={sigma.ok ? undefined : `xye-why-${pattern.id}`}
                onClick={() =>
                  sigma.ok &&
                  save(
                    patternXye(pattern.twoTheta, pattern.intensity, sigma.sigma, {
                      header: [...measuredHeader, `Uncertainty: ${sigma.how}`],
                      wavelengthA,
                      intensityLabel: `intensity (${pattern.intensityUnit})`,
                    }),
                    `${stem}-measured.xye`,
                  )
                }
              >
                Measured .xye
              </button>
              <button
                type="button"
                class="btn"
                disabled={!result}
                onClick={() =>
                  result &&
                  save(
                    patternXy(result.twoTheta, result.intensity, {
                      header: [
                        `Pattern: ${pattern.name}`,
                        'Processed data (after the Clean data steps), written by Plot Bhai',
                        `Intensity unit: ${processedUnit}`,
                      ],
                      wavelengthA,
                      intensityLabel: `intensity (${processedUnit})`,
                    }),
                    `${stem}-processed.xy`,
                  )
                }
              >
                Processed .xy
              </button>
              {!sigma.ok && (
                <span class="field-hint" id={`xye-why-${pattern.id}`}>
                  No .xye: {sigma.reason}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
