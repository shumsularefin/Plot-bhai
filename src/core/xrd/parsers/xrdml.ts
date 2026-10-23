import type { DataMessage, IntensityUnit, ParseResult } from '../types';
import { parseNumber, parseNumberList } from './numbers';

/*
 * PANalytical XRDML reader. Structure (checked against the XRDML readers in xrayutilities,
 * io/panalytical_xml.py, and GSAS-II, imports/G2pwd_Panalytical.py):
 *
 *   <xrdMeasurement> <usedWavelength> <kAlpha1 unit="Angstrom">…</kAlpha1> … </usedWavelength>
 *     <scan status="Completed" scanAxis="Gonio">
 *       <dataPoints>
 *         <positions axis="2Theta" unit="deg">
 *           <startPosition>…</startPosition><endPosition>…</endPosition>   (evenly spaced)
 *           or <listPositions>…</listPositions> or <commonPosition>…</commonPosition>
 *         </positions>
 *         <commonCountingTime unit="seconds">…</commonCountingTime>
 *         <intensities unit="counts">…</intensities>   (newer files, attenuation already applied)
 *         or <counts unit="counts">…</counts> with optional <beamAttenuationFactors>
 *
 * A small regular-expression reader is used instead of DOMParser so the same code runs in a
 * web worker, where DOMParser is not available.
 */

const NS = '(?:[\\w.-]+:)?'; // optional namespace prefix

function elements(xml: string, tag: string): { attrs: string; body: string }[] {
  const re = new RegExp(`<${NS}${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${NS}${tag}>)`, 'g');
  return [...xml.matchAll(re)].map((m) => ({ attrs: m[1] ?? '', body: m[2] ?? '' }));
}

function attribute(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];
}

function firstText(xml: string, tag: string): string | undefined {
  return elements(xml, tag)[0]?.body.trim();
}

export function looksLikeXrdml(text: string): boolean {
  return new RegExp(`<${NS}xrdMeasurement\\b`).test(text.slice(0, 20000));
}

export function parseXrdml(text: string): ParseResult {
  const scans = elements(text, 'scan');
  if (scans.length === 0) return { ok: false, error: 'This XRDML file contains no scan data.' };

  const notes: DataMessage[] = [];
  const completed = scans.findIndex((s) => attribute(s.attrs, 'status') === 'Completed');
  const index = completed === -1 ? 0 : completed;
  const scan = scans[index] as { attrs: string; body: string };
  if (scans.length > 1) {
    notes.push({
      level: 'warning',
      text: `This file contains ${scans.length} scans. Only scan ${index + 1} was loaded.`,
    });
  }
  const status = attribute(scan.attrs, 'status');
  if (status && status !== 'Completed') {
    notes.push({
      level: 'warning',
      text: `The scan status in the file is "${status}", so the measurement may have stopped early.`,
    });
  }

  const twoThetaAxis = elements(scan.body, 'positions').find(
    (p) => attribute(p.attrs, 'axis') === '2Theta',
  );
  if (!twoThetaAxis) return { ok: false, error: 'This XRDML scan has no 2θ positions.' };
  const unitAttr = attribute(twoThetaAxis.attrs, 'unit');
  if (unitAttr && unitAttr !== 'deg') {
    return { ok: false, error: `The 2θ positions in this file are in "${unitAttr}", not degrees.` };
  }

  const intensityElement = elements(scan.body, 'intensities')[0];
  const countsElement = intensityElement ? undefined : elements(scan.body, 'counts')[0];
  const dataElement = intensityElement ?? countsElement;
  if (!dataElement) return { ok: false, error: 'This XRDML scan has no intensity values.' };
  let intensity = parseNumberList(dataElement.body);
  if (!intensity || intensity.length === 0) {
    return { ok: false, error: 'The intensity values in this XRDML file could not be read.' };
  }

  // Older files store raw <counts>; their attenuation factors still have to be applied.
  if (countsElement) {
    const factorsText = firstText(scan.body, 'beamAttenuationFactors');
    const factors = factorsText === undefined ? null : parseNumberList(factorsText);
    if (factors && factors.length === intensity.length) {
      intensity = intensity.map((value, i) => value * (factors[i] as number));
      notes.push({ level: 'info', text: 'Beam attenuation factors from the file were applied.' });
    }
  }

  const n = intensity.length;
  let twoTheta: number[];
  const list = firstText(twoThetaAxis.body, 'listPositions');
  const start = parseNumber(firstText(twoThetaAxis.body, 'startPosition') ?? '');
  const end = parseNumber(firstText(twoThetaAxis.body, 'endPosition') ?? '');
  if (list !== undefined) {
    const values = parseNumberList(list);
    if (!values)
      return { ok: false, error: 'The 2θ positions in this XRDML file could not be read.' };
    twoTheta = values;
  } else if (!Number.isNaN(start) && !Number.isNaN(end)) {
    // Evenly spaced from start to end inclusive, as both reference readers do.
    twoTheta = Array.from({ length: n }, (_, i) =>
      n === 1 ? start : start + ((end - start) * i) / (n - 1),
    );
  } else if (firstText(twoThetaAxis.body, 'commonPosition') !== undefined) {
    const axis = attribute(scan.attrs, 'scanAxis') ?? 'another axis';
    return {
      ok: false,
      error: `This XRDML file is a scan of ${axis} with 2θ held fixed (for example a rocking curve), not a 2θ scan. Only 2θ scans can be analysed here.`,
    };
  } else {
    return { ok: false, error: 'The 2θ positions in this XRDML file could not be read.' };
  }
  if (twoTheta.length !== n) {
    return {
      ok: false,
      error: `This XRDML file has ${twoTheta.length} 2θ positions but ${n} intensity values, so they cannot be paired.`,
    };
  }

  const unitText = attribute(dataElement.attrs, 'unit');
  const unitFromFile: IntensityUnit | undefined =
    unitText === 'counts' ? 'counts' : unitText === 'cps' ? 'cps' : undefined;
  const countingTimeS = parseNumber(firstText(scan.body, 'commonCountingTime') ?? '');
  const kAlpha1 = elements(text, 'kAlpha1')[0];
  const wavelengthUnit = kAlpha1 && attribute(kAlpha1.attrs, 'unit');
  const wavelength =
    kAlpha1 && (wavelengthUnit === undefined || wavelengthUnit === 'Angstrom')
      ? parseNumber(kAlpha1.body.trim())
      : NaN;

  return {
    ok: true,
    scan: {
      twoTheta,
      intensity,
      ...(unitFromFile && { unitFromFile }),
      ...(countingTimeS > 0 && { countingTimeS }),
      ...(wavelength > 0 && { wavelengthFromFileA: wavelength }),
      notes,
    },
  };
}
