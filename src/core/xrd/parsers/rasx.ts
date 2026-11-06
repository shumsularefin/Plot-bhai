import { decodeText } from '../../text/bytes';
import type { DataMessage, IntensityUnit, ParseResult } from '../types';
import { parseNumber } from './numbers';
import { elements, firstText } from './xml';

/*
 * Rigaku .rasx reader (SmartLab Studio II). A .rasx file is a ZIP archive:
 *
 *   root.xml                               lists the data groups: <Data0 Type="Profile"> …
 *   Data0/Profile0.txt                     one point per line: 2θ, intensity, attenuator factor
 *   Data0/MesurementConditions0.xml        (spelt so by Rigaku) scan axis, unit, wavelengths
 *
 * Checked against two independent readers, which both take column 1 as 2θ and column 2 as the
 * intensity and do not multiply by column 3: GSAS-II (imports/G2pwd_rigaku.py) and geddes
 * (src/xml.rs, parse_rasx). This reader does the same and, as for .ras, warns when column 3 is
 * not 1 everywhere. The profile text starts with a UTF-8 byte-order mark and uses CRLF lines.
 */

/** Files of a .rasx archive this reader needs. */
export function rasxWanted(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    /^data\d+\/profile\d*\.txt$/.test(lower) || /^data\d+\/[^/]*conditions[^/]*\.xml$/.test(lower)
  );
}

export function looksLikeRasx(names: Iterable<string>): boolean {
  return [...names].some((n) => /^data\d+\/profile\d*\.txt$/i.test(n));
}

export function parseRasx(files: Map<string, Uint8Array>): ParseResult {
  const names = [...files.keys()];
  const groups = [
    ...new Set(
      names
        .map((n) => /^(data\d+)\/profile\d*\.txt$/i.exec(n)?.[1])
        .filter((g): g is string => g !== undefined),
    ),
  ].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  const group = groups[0];
  if (!group) return { ok: false, error: 'This .rasx file contains no profile data.' };
  const inGroup = (pattern: RegExp) =>
    names.find((n) => n.toLowerCase().startsWith(`${group.toLowerCase()}/`) && pattern.test(n));
  const profileName = inGroup(/\/profile\d*\.txt$/i) as string;
  const conditionsName = inGroup(/conditions[^/]*\.xml$/i);

  const notes: DataMessage[] = [];
  if (groups.length > 1) {
    notes.push({
      level: 'warning',
      text: `This file contains ${groups.length} scans. Only the first (${group}) was loaded.`,
    });
  }

  const twoTheta: number[] = [];
  const intensity: number[] = [];
  let skipped = 0;
  let attenuated = false;
  const text = decodeText(files.get(profileName) as Uint8Array, 'utf-8').replace(/^\uFEFF/, '');
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const [angle, counts, attenuator] = line.split(/\s+/).map(parseNumber);
    if (
      angle === undefined ||
      counts === undefined ||
      Number.isNaN(angle) ||
      Number.isNaN(counts)
    ) {
      skipped++;
      continue;
    }
    twoTheta.push(angle);
    intensity.push(counts);
    if (attenuator !== undefined && !Number.isNaN(attenuator) && attenuator !== 1)
      attenuated = true;
  }
  if (skipped > 0) {
    notes.push({
      level: 'warning',
      text: `${skipped} data lines could not be read and were skipped.`,
    });
  }
  if (attenuated) {
    notes.push({
      level: 'warning',
      text: 'The third column (attenuator factor) is not 1 everywhere. It was not applied to the intensities. Check in SmartLab Studio whether the exported intensities are already corrected.',
    });
  }

  let unitFromFile: IntensityUnit | undefined;
  let wavelengthFromFileA: number | undefined;
  const metadata: { key: string; value: string }[] = [];
  if (conditionsName) {
    const xml = decodeText(files.get(conditionsName) as Uint8Array, 'utf-8');
    const scan = elements(xml, 'ScanInformation')[0]?.body ?? xml;
    const axis = firstText(scan, 'AxisName');
    if (axis && !/^(twotheta|2theta)/i.test(axis)) {
      notes.push({
        level: 'warning',
        text: `The scan axis in this file is "${axis}", not 2θ. The first column was read as 2θ anyway, so check this is the right file.`,
      });
    }
    const unit = firstText(scan, 'IntensityUnit');
    if (unit && /^cps$/i.test(unit)) unitFromFile = 'cps';
    else if (unit && /^counts?$/i.test(unit)) {
      if (intensity.every(Number.isInteger)) unitFromFile = 'counts';
      else {
        notes.push({
          level: 'info',
          text: 'The file states the intensity unit is counts, but the values are not whole numbers, so the instrument software may have scaled them. Check the unit below.',
        });
      }
    }
    const kAlpha1 = parseNumber(firstText(xml, 'WavelengthKalpha1') ?? '');
    if (Number.isFinite(kAlpha1) && kAlpha1 > 0) wavelengthFromFileA = kAlpha1;
    const entries: [string, string | undefined][] = [
      ['Target', firstText(xml, 'TargetName')],
      ['Scan axis', axis],
      ['Scan mode', firstText(scan, 'Mode')],
      ['Start (°)', firstText(scan, 'Start')],
      ['Stop (°)', firstText(scan, 'Stop')],
      ['Step (°)', firstText(scan, 'Step')],
      ['Speed', joined(firstText(scan, 'Speed'), firstText(scan, 'SpeedUnit'))],
      ['Intensity unit', unit],
      ['Start time', firstText(scan, 'StartTime')],
    ];
    for (const [key, value] of entries) if (value) metadata.push({ key, value });
  }

  return {
    ok: true,
    scan: {
      twoTheta,
      intensity,
      ...(unitFromFile && { unitFromFile }),
      ...(wavelengthFromFileA !== undefined && { wavelengthFromFileA }),
      ...(metadata.length > 0 && { metadata }),
      notes,
    },
  };
}

function joined(value: string | undefined, unit: string | undefined): string | undefined {
  return value ? `${value}${unit ? ` ${unit}` : ''}` : undefined;
}
