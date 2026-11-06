import { decodeText } from '../../text/bytes';
import type { DataMessage, ParseResult } from '../types';
import { parseNumber } from './numbers';
import { attribute, elements, firstText } from './xml';

/*
 * Bruker .brml reader (DIFFRAC.SUITE). A .brml file is a ZIP archive:
 *
 *   Experiment0/DataContainer.xml    <RawDataReferenceList><string>Experiment0/RawData0.xml …
 *   Experiment0/RawData0.xml         <DataRoute RouteFlag="Measured">
 *                                       <ScanInformation> … axes, steps, time per step
 *                                       <Datum>v0,v1,v2,…</Datum> one per point
 *                                       <DataViews> what each comma-separated value means:
 *                                         <RawDataView xsi:type="FixedRawDataView" Start="1"
 *                                            LogicName="AbsorptionFactor"/>
 *                                         <RawDataView xsi:type="VaryingRawDataView" Start="2">
 *                                            <FieldDefinitions AxisId="TwoTheta"/> …
 *                                         <RawDataView xsi:type="RecordedRawDataView" Start="4"
 *                                            Length="1"/>   the detector counts
 *
 * The 2θ column is the TwoTheta field of a varying view, and the intensity is the recorded
 * view, both found from DataViews rather than assumed. This follows geddes (src/xml.rs,
 * parse_brml), an independent reader. Bruker stores the intensity with the automatic absorber
 * already applied: in the real test file, every point with an absorption factor of 8.3 has a
 * stored intensity that is a whole number of counts times 8.3. So the stored value is used.
 */

/** Files of a .brml archive this reader needs. */
export function brmlWanted(name: string): boolean {
  return /(^|\/)DataContainer\.xml$/i.test(name) || /(^|\/)RawData\d*\.xml$/i.test(name);
}

export function looksLikeBrml(names: Iterable<string>): boolean {
  return [...names].some((n) => /(^|\/)DataContainer\.xml$/i.test(n));
}

export function parseBrml(files: Map<string, Uint8Array>): ParseResult {
  const names = [...files.keys()];
  const containerName = names.find((n) => /(^|\/)DataContainer\.xml$/i.test(n));
  if (!containerName) return { ok: false, error: 'This .brml file has no DataContainer.xml.' };
  const container = decodeText(files.get(containerName) as Uint8Array, 'utf-8');
  const list = elements(container, 'RawDataReferenceList')[0]?.body ?? '';
  const references = elements(list, 'string')
    .map((s) => s.body.trim())
    .filter((s) => s !== '');
  const rawName = references.find((r) => files.has(r));
  if (!rawName) return { ok: false, error: 'This .brml file contains no measured data.' };

  const notes: DataMessage[] = [];
  if (references.length > 1) {
    notes.push({
      level: 'warning',
      text: `This file contains ${references.length} scans. Only the first was loaded.`,
    });
  }

  const raw = decodeText(files.get(rawName) as Uint8Array, 'utf-8');
  const routes = elements(raw, 'DataRoute');
  const measured = routes.filter((r) => attribute(r.attrs, 'RouteFlag') === 'Measured');
  const route = measured.length === 1 ? measured[0] : routes.length === 1 ? routes[0] : undefined;
  if (!route) {
    return {
      ok: false,
      error:
        'This .brml file holds several data routes and none is marked as the measured one, so it is not clear which to read. Export the scan as .xy from DIFFRAC.EVA.',
    };
  }

  let xColumn: number | undefined;
  let yColumn: number | undefined;
  let absorberColumn: number | undefined;
  for (const view of elements(route.body, 'RawDataView')) {
    const start = Number(attribute(view.attrs, 'Start'));
    const length = Number(attribute(view.attrs, 'Length'));
    if (!Number.isInteger(start) || !Number.isInteger(length)) continue;
    const type = (attribute(view.attrs, 'xsi:type') ?? '').split(':').pop();
    if (type === 'VaryingRawDataView') {
      elements(view.body, 'FieldDefinitions').forEach((field, offset) => {
        const axis = attribute(field.attrs, 'AxisId') || attribute(field.attrs, 'FieldName');
        if (xColumn === undefined && axis?.trim().toLowerCase() === 'twotheta') {
          xColumn = start + offset;
        }
      });
    } else if (type === 'RecordedRawDataView') {
      if (length !== 1) {
        return {
          ok: false,
          error:
            'This .brml file holds 2D detector frames, not a 1D pattern. Integrate it to a 2θ pattern in DIFFRAC.EVA and export it as .xy.',
        };
      }
      yColumn ??= start;
    } else if (attribute(view.attrs, 'LogicName') === 'AbsorptionFactor') {
      absorberColumn = start;
    }
  }
  if (xColumn === undefined) {
    return {
      ok: false,
      error:
        'This .brml scan does not move 2θ (for example a rocking curve), so it is not a powder pattern.',
    };
  }
  if (yColumn === undefined) {
    return { ok: false, error: 'This .brml file does not say which column holds the counts.' };
  }

  const twoTheta: number[] = [];
  const intensity: number[] = [];
  let skipped = 0;
  let absorbed = false;
  for (const match of route.body.matchAll(/<Datum>([^<]*)<\/Datum>/g)) {
    const values = (match[1] as string).split(',').map((v) => parseNumber(v.trim()));
    const x = values[xColumn];
    const y = values[yColumn];
    if (x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y)) {
      skipped++;
      continue;
    }
    twoTheta.push(x);
    intensity.push(y);
    if (absorberColumn !== undefined && values[absorberColumn] !== 1) absorbed = true;
  }
  if (skipped > 0) {
    notes.push({
      level: 'warning',
      text: `${skipped} data points could not be read and were skipped.`,
    });
  }
  if (absorbed) {
    notes.push({
      level: 'info',
      text: 'The automatic beam absorber was in for some points. The stored intensities already include its factor, so they are used as stored.',
    });
  }

  const scan = elements(route.body, 'ScanInformation')[0];
  const planned = Number(firstText(scan?.body ?? '', 'MeasurementPoints'));
  if (Number.isInteger(planned) && planned > twoTheta.length) {
    notes.push({
      level: 'warning',
      text: `The scan was planned with ${planned} points but holds ${twoTheta.length}, so the measurement may have stopped early.`,
    });
  }

  const alpha1 = elements(raw, 'WaveLengthAlpha1')[0];
  const wavelength = alpha1 ? parseNumber(attribute(alpha1.attrs, 'Value') ?? '') : NaN;
  const metadata: { key: string; value: string }[] = [];
  const add = (key: string, value: string | undefined) => {
    if (value) metadata.push({ key, value });
  };
  add('Instrument', firstText(container, 'InstrumentName'));
  add('Scan', scan ? attribute(scan.attrs, 'VisibleName')?.trim() : undefined);
  add('Scan mode', firstText(scan?.body ?? '', 'ScanModeVisibleName'));
  add('Time per step (s)', firstText(scan?.body ?? '', 'TimePerStep'));
  add('Points', firstText(scan?.body ?? '', 'MeasurementPoints'));
  const tube = elements(raw, 'Tube')[0];
  add('Tube', tube ? attribute(tube.attrs, 'VisibleName') : undefined);

  return {
    ok: true,
    scan: {
      twoTheta,
      intensity,
      ...(Number.isFinite(wavelength) && wavelength > 0 && { wavelengthFromFileA: wavelength }),
      ...(metadata.length > 0 && { metadata }),
      notes,
    },
  };
}
