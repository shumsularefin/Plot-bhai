import type { DataMessage, ParseResult } from '../types';
import { parseNumber } from './numbers';

/*
 * Rigaku .ras reader (ASCII). Structure, checked against the RAS readers in xrayutilities
 * (io/rigaku_ras.py) and GSAS-II (imports/G2pwd_rigaku.py):
 *
 *   *RAS_DATA_START
 *   *RAS_HEADER_START
 *   *KEY "value"            for example *MEAS_SCAN_AXIS_X_INTERNAL "TwoThetaTheta"
 *   *RAS_HEADER_END
 *   *RAS_INT_START
 *   angle intensity attenuator     three columns per line
 *   *RAS_INT_END
 *   (more header/data blocks for further scans)
 *   *RAS_DATA_END
 *
 * Both reference readers take column 2 as the intensity and do not multiply by column 3,
 * so this reader does the same and warns when column 3 is not 1 everywhere.
 */

export function looksLikeRas(text: string): boolean {
  return text.slice(0, 2000).includes('*RAS_DATA_START');
}

export function parseRas(text: string): ParseResult {
  const lines = text.split(/\r\n|\r|\n/).map((l) => l.trim());
  const scanCount = lines.filter((l) => l === '*RAS_INT_START').length;
  if (scanCount === 0) return { ok: false, error: 'This .ras file contains no data block.' };

  const header = new Map<string, string>();
  const twoTheta: number[] = [];
  const intensity: number[] = [];
  let attenuated = false;
  let skipped = 0;
  let section: 'before' | 'header' | 'data' = 'before';

  for (const line of lines) {
    if (line === '*RAS_HEADER_START') section = 'header';
    else if (line === '*RAS_HEADER_END') section = 'before';
    else if (line === '*RAS_INT_START') section = 'data';
    else if (line === '*RAS_INT_END')
      break; // first scan only
    else if (section === 'header') {
      const match = /^\*(\S+)\s+"?(.*?)"?$/.exec(line);
      if (match) header.set(match[1] as string, match[2] as string);
    } else if (section === 'data' && line !== '') {
      const values = line.split(/\s+/).map(parseNumber);
      const [angle, counts, attenuator] = values;
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
  }

  const notes: DataMessage[] = [];
  if (scanCount > 1) {
    notes.push({
      level: 'warning',
      text: `This file contains ${scanCount} scans. Only the first was loaded.`,
    });
  }
  if (skipped > 0) {
    notes.push({
      level: 'warning',
      text: `${skipped} data lines could not be read and were skipped.`,
    });
  }
  const axis = header.get('MEAS_SCAN_AXIS_X_INTERNAL') ?? header.get('MEAS_SCAN_AXIS_X');
  if (axis && !/twotheta/i.test(axis)) {
    notes.push({
      level: 'warning',
      text: `The scan axis in this file is "${axis}", not 2θ. The first column was read as 2θ anyway, so check this is the right file.`,
    });
  }
  if (attenuated) {
    notes.push({
      level: 'warning',
      text: 'The third column (attenuator factor) is not 1 everywhere. It was not applied to the intensities. Check in your instrument software whether the exported intensities are already corrected.',
    });
  }
  return { ok: true, scan: { twoTheta, intensity, notes } };
}
