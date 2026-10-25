import { phaseReference } from '../../core/xrd/reference/source';
import { methodsParagraph, type MethodsInput } from '../../core/xrd/report/methods';
import { ANODES } from '../../core/xrd/radiation';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import { stepStats } from '../../core/xrd/summary';
import { peaksFor, processingFor, type XrdData } from './data';
import { METHOD_NAMES, sizeResults, type MethodId } from './sizeResults';

const SOFTWARE = 'XRD Toolkit (free, runs in the browser; version not recorded)';

/** The settings that went into the analysis, read from the saved session. */
export function methodsInput(data: XrdData, library: readonly ReferencePhase[]): MethodsInput {
  const first = data.patterns[0];
  const processing = first ? processingFor(data, first.id) : processingFor(data, '');
  const lines = ANODES[data.radiation.anode];
  const step = first ? stepStats(first.twoTheta) : null;

  const fitted = data.patterns.map((p) => peaksFor(data, p.id)).find((s) => s.fit);
  const used = new Set<MethodId>();
  for (const p of data.patterns) {
    const results = sizeResults(data, p.id);
    if (results.kind === 'ok')
      for (const row of results.summary) if (row.size !== null) used.add(row.method);
  }

  const { instrument } = data;
  const standard = instrument.standard;
  return {
    software: SOFTWARE,
    radiation: {
      anode: data.radiation.anode,
      kAlpha1A: lines.kAlpha1,
      kAlpha2A: lines.kAlpha2,
      kAlpha1Only: data.radiation.kAlpha1Only,
    },
    scan:
      first && step && Number.isFinite(step.median)
        ? {
            fromDeg: first.twoTheta[0] as number,
            toDeg: first.twoTheta[first.twoTheta.length - 1] as number,
            stepDeg: step.median,
          }
        : null,
    patterns: data.patterns.length,
    allSynthetic: data.patterns.length > 0 && data.patterns.every((p) => p.synthetic),
    processing: {
      zeroShiftDeg: processing.zeroShift.enabled ? processing.zeroShift.shiftDeg : null,
      smoothing: processing.smoothing.enabled
        ? { window: processing.smoothing.window, order: processing.smoothing.order }
        : null,
      background: processing.background.enabled
        ? {
            method: processing.background.method,
            degree: processing.background.degree,
            snipWidthDeg: processing.background.snipWidthDeg,
            anchors: processing.background.anchors.length,
          }
        : null,
      kAlpha2Stripped:
        processing.kAlpha2.enabled && !data.radiation.kAlpha1Only
          ? { ratio: data.radiation.kAlpha2Ratio }
          : null,
      normalisedTo: processing.normalise.enabled ? processing.normalise.target : null,
    },
    fit: fitted
      ? { profile: fitted.fitOptions.profile, fixedEta: fitted.fitOptions.fixedEta }
      : null,
    instrument:
      instrument.source === 'skip'
        ? { kind: 'skipped' }
        : {
            kind: instrument.source,
            method: instrument.method,
            ...(instrument.source === 'constant' &&
              instrument.constantFwhm !== null && { fwhmDeg: instrument.constantFwhm }),
            ...(instrument.source === 'standard' &&
              standard && { standardMaterial: standard.material }),
          },
    size:
      used.size > 0 ? { k: data.results.k, methods: [...used].map((m) => METHOD_NAMES[m]) } : null,
    phases: library
      .filter((p) => data.material.phaseIds.includes(p.id))
      .map((p) => ({ name: p.name, formula: p.formula, reference: phaseReference(p) })),
    toleranceDeg: data.material.toleranceDeg,
  };
}

/** The methods paragraph for the whole session; says so when patterns were treated differently. */
export function methodsFor(data: XrdData, library: readonly ReferencePhase[]): string {
  const text = methodsParagraph(methodsInput(data, library));
  const [first, ...others] = data.patterns;
  if (!first) return text;
  const key = (id: string) =>
    JSON.stringify([processingFor(data, id), peaksFor(data, id).fitOptions]);
  return others.some((p) => key(p.id) !== key(first.id))
    ? `${text} The patterns were not all treated alike; the preprocessing and fitting settings above are those of "${first.name}".`
    : text;
}
