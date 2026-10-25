import { phaseReference } from '../../core/xrd/reference/source';
import { useMemo } from 'preact/hooks';
import type { LatticeFit } from '../../core/xrd/reference/lattice';
import { formatWithSigma } from '../../ui/format';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import { downloadTable } from './csv';
import { assignedPeaksTable, assignmentNotes as notes, sign } from './tables';
import type { XrdData } from './data';
import {
  peakLabelSet,
  type AssignmentResult,
  type LatticeSummary,
  type PhaseAssignment,
} from './assignment';
import { xrdLabels } from './labels';
import { TableBox } from './MethodDetails';
import { codUrl } from './referenceLibrary';
import { useProcessed } from './useProcessed';
import { processingFor } from './data';

interface AssignmentSectionProps {
  data: XrdData;
  update: (patch: Partial<XrdData>) => void;
  patternId: string;
  /** Null with the reason why no assignment could be made. */
  result: AssignmentResult | { reason: string };
  refineZeroShift: boolean;
  onRefineZeroShift: (on: boolean) => void;
}

/** Step 7: the labelled figure, the combined peak table and the lattice parameters. */
export function AssignmentSection({
  data,
  update,
  patternId,
  result,
  refineZeroShift,
  onRefineZeroShift,
}: AssignmentSectionProps) {
  return (
    <section class="peak-table-section" aria-labelledby="assignment-title">
      <h3 id="assignment-title" class="export-title">
        Phases, (hkl) labels and lattice parameters
      </h3>
      {'reason' in result ? (
        <p class="message is-info" role="note">
          <strong>Note:</strong> {result.reason}
        </p>
      ) : (
        <AssignmentBody
          data={data}
          update={update}
          patternId={patternId}
          result={result}
          refineZeroShift={refineZeroShift}
          onRefineZeroShift={onRefineZeroShift}
        />
      )}
    </section>
  );
}

function AssignmentBody({
  data,
  update,
  patternId,
  result,
  refineZeroShift,
  onRefineZeroShift,
}: Omit<AssignmentSectionProps, 'result'> & { result: AssignmentResult }) {
  const pattern = data.patterns.find((p) => p.id === patternId);
  const { result: processed } = useProcessed(
    pattern,
    processingFor(data, patternId),
    data.radiation,
  );
  const sources = useMemo<SeriesSource[]>(
    () =>
      processed && pattern
        ? [
            {
              id: 'data',
              name: pattern.name,
              x: processed.twoTheta,
              y: processed.intensity,
              unit: pattern.intensityUnit === 'counts' ? 'counts' : 'cps',
              colorIndex: 7,
            },
          ]
        : [],
    [processed, pattern],
  );
  const labelSet = peakLabelSet(result);
  if (!pattern) return null;
  const material = data.material;
  const jcpds = (id: string) => material.jcpds[id]?.trim() ?? '';
  const ambiguous = result.peaks.filter((p) => p.phase && p.assignment.candidates.length > 1);

  const exportCsv = () => downloadTable(assignedPeaksTable(data, pattern.name, result));

  return (
    <div class="assignment">
      <p class="field-hint">
        These are suggestions, not identifications. Each fitted peak is given the nearest reference
        line of your chosen phases within {material.toleranceDeg}° 2θ, after shifting the phase by
        its best zero shift (found from your fitted peaks). Change the tolerance in step 4.
        {result.unassigned > 0 &&
          ` ${result.unassigned} of ${result.peaks.length} peaks have no reference line nearby and are unassigned (no label).`}
      </p>

      {processed ? (
        <PlotPanel
          sources={sources}
          settings={data.plot}
          onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
          labels={xrdLabels}
          xName="2θ"
          xUnit="°"
          exportName={`${pattern.name}-hkl`}
          showOverlayOptions={false}
          peakLabels={labelSet}
        />
      ) : (
        <p aria-busy="true">Preparing the pattern…</p>
      )}
      {ambiguous.length > 0 && (
        <p class="field-hint">
          Where two reflections lie within the tolerance of one peak, both are shown, for example
          (004)/(112). Such peaks are left out of the lattice fit because their index is not
          certain.
        </p>
      )}

      <div class="peak-table-section">
        <h4 class="export-subtitle">Assigned peaks</h4>
        <TableBox label="Assigned peaks" onExport={exportCsv}>
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">COD ID</th>
              <th scope="col">JCPDS no. (entered by user, not verified)</th>
              <th scope="col">(hkl)</th>
              <th scope="col">2θ obs (°)</th>
              <th scope="col">2θ ref (°)</th>
              <th scope="col">Δ2θ (°)</th>
              <th scope="col">d obs (Å)</th>
              <th scope="col">d ref (Å)</th>
              <th scope="col">I/I₀ obs (%)</th>
              <th scope="col">I/I₀ ref (%)</th>
              <th scope="col">FWHM (°)</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {result.peaks.map((p) => (
              <tr key={p.index} class={p.phase ? undefined : 'is-limited'}>
                <td>{p.phase?.name ?? 'unassigned'}</td>
                <td>{p.phase ? phaseReference(p.phase) : '–'}</td>
                <td>{(p.phase && jcpds(p.phase.id)) || '–'}</td>
                <td>{p.hklText || '–'}</td>
                <td>{p.peak.twoTheta.toFixed(3)}</td>
                <td>{p.line ? p.line.twoTheta.toFixed(3) : '–'}</td>
                <td>{p.line ? sign(p.peak.twoTheta - p.line.twoTheta, 3) : '–'}</td>
                <td>{p.peak.d.toFixed(4)}</td>
                <td>{p.line ? p.line.d.toFixed(4) : '–'}</td>
                <td>{p.peak.relativeIntensity.toFixed(1)}</td>
                <td>{p.line ? p.line.intensity.toFixed(1) : '–'}</td>
                <td>{p.peak.fwhm.toFixed(3)}</td>
                <td>{notes(p).join(' ') || '–'}</td>
              </tr>
            ))}
          </tbody>
        </TableBox>
        <p class="field-hint">
          Reference values are calculated from the COD structure for {data.radiation.anode} Kα1 and
          are not shifted; Δ2θ = observed − reference.
        </p>
      </div>

      <h4 class="export-subtitle">
        Lattice parameters{' '}
        <HelpTip term="lattice parameters">
          <p>
            The unit-cell edges are found by least squares from the positions of the indexed peaks,
            using 1/d² = h²/a² + … (the form depends on the crystal system). A zero shift (for
            example from a sample set too high or low in the holder) moves all peaks together and
            would be mistaken for a change in the cell, so you can refine it as well.
          </p>
        </HelpTip>
      </h4>
      <label class="check">
        <input
          type="checkbox"
          checked={refineZeroShift}
          onChange={(e) => onRefineZeroShift(e.currentTarget.checked)}
        />
        Also refine a zero shift (needs one more indexed peak)
      </label>
      {result.phases.map((phase) => (
        <LatticeCard key={phase.phase.id} phase={phase} />
      ))}
      <p class="field-hint">
        The cell values are estimates. Their uncertainties come only from the scatter of the peak
        positions; a sample-height error or a poorly calibrated instrument adds more.
      </p>
    </div>
  );
}

function LatticeCard({ phase }: { phase: PhaseAssignment }) {
  const { phase: ref, lattice } = phase;
  return (
    <div class="lattice-card">
      <h5 class="lattice-title">
        {ref.name} (
        {ref.codId !== null ? (
          <a href={codUrl(ref.codId)} target="_blank" rel="noopener noreferrer">
            {phaseReference(ref)}
          </a>
        ) : (
          phaseReference(ref)
        )}
        ), {ref.crystalSystem}, {ref.spaceGroup.hm}
      </h5>
      <p class="field-hint">
        Zero shift that best aligned this phase: {sign(phase.shift, 2)}°. {phase.assigned} peak
        {phase.assigned === 1 ? '' : 's'} assigned.
      </p>
      {'unsupported' in lattice ? (
        <p class="message is-info">
          <strong>Note:</strong> {lattice.unsupported}
        </p>
      ) : !lattice.outcome.ok ? (
        <p class="message is-warning">
          <strong>Check:</strong> {lattice.outcome.reason}
        </p>
      ) : (
        <LatticeTable fit={lattice.outcome.fit} summary={lattice} />
      )}
    </div>
  );
}

const percent = (value: number, reference: number) => {
  const p = (100 * (value - reference)) / reference;
  return `${p < 0 ? '−' : '+'}${Math.abs(p).toFixed(2)} %`;
};

function LatticeTable({ fit, summary }: { fit: LatticeFit; summary: LatticeSummary }) {
  const rows = [
    ...fit.edges.map((e, j) => ({
      name: `${e.name} (Å)`,
      value: e.a,
      reference: summary.reference[j] as number,
    })),
    { name: 'Cell volume (Å³)', value: fit.volume, reference: summary.referenceVolume },
  ];
  return (
    <>
      <div class="table-scroll" tabIndex={0} role="region" aria-label="Lattice parameters">
        <table class="peak-table">
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              <th scope="col">Refined</th>
              <th scope="col">Library cell</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.name}</th>
                <td>{formatWithSigma(r.value.value, r.value.sigma)}</td>
                <td>{r.reference.toPrecision(6)}</td>
                <td>{percent(r.value.value, r.reference)}</td>
              </tr>
            ))}
            {fit.zeroShift && (
              <tr>
                <th scope="row">Zero shift (°)</th>
                <td>{formatWithSigma(fit.zeroShift.value, fit.zeroShift.sigma)}</td>
                <td>–</td>
                <td>–</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p class="field-hint">
        ± is one standard uncertainty. From {fit.n} peaks ({fit.dof} degrees of freedom), RMS
        residual {fit.rms.toFixed(4)}° 2θ.
        {summary.skipped > 0 &&
          ` ${summary.skipped} assigned peak${summary.skipped === 1 ? ' was' : 's were'} left out because the index is not unique.`}
        {fit.dof === 0 &&
          ' With no spare peaks the uncertainties cannot be checked against the scatter.'}
      </p>
    </>
  );
}
