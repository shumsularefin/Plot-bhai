// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOLERANCE_CM, suggestAssignments, type GroupTable } from '../src/core/ftir/assign';
import {
  parseFunctionalGroups,
  parseMetalOxides,
  parseRanges,
  tableWrap,
} from '../scripts/ftir-groups-parse';

const table = JSON.parse(
  readFileSync(new URL('../data/ftir/groups.json', import.meta.url), 'utf8'),
) as GroupTable;
const cached = readFileSync(new URL('../data/ftir/source/tables.xml', import.meta.url), 'utf8');

describe('range parser', () => {
  it('reads ranges high to low, single values, tildes and run-together ranges', () => {
    expect(parseRanges('3730–3520').ranges).toEqual([{ from: 3520, to: 3730 }]);
    expect(parseRanges('~1660')).toEqual({ ranges: [{ from: 1660, to: 1660 }], approximate: true });
    expect(parseRanges('3540–34803420–3380').ranges).toEqual([
      { from: 3480, to: 3540 },
      { from: 3380, to: 3420 },
    ]);
    expect(parseRanges('1305–12001190–11701145–1130').ranges).toHaveLength(3);
  });
});

describe('data/ftir/groups.json', () => {
  it('matches what the parser reads from the cached source tables', () => {
    const groups = parseFunctionalGroups(tableWrap(cached, 1) ?? '');
    const oxides = parseMetalOxides(tableWrap(cached, 0) ?? '');
    expect(table.functionalGroups).toEqual(groups);
    expect(table.metalOxides).toEqual(oxides);
    expect(groups.length).toBeGreaterThan(50);
  });

  it('has a source, a licence and a verification flag, and sane numbers', () => {
    expect(table.source.doi).toBe('10.3390/molecules30030684');
    expect(table.source.licence).toContain('CC BY 4.0');
    expect(table.verification).toContain('TODO, verify');
    for (const g of table.functionalGroups) {
      expect(g.ranges.length).toBeGreaterThan(0);
      for (const r of g.ranges) {
        expect(r.from).toBeLessThanOrEqual(r.to);
        expect(r.from).toBeGreaterThan(300);
        expect(r.to).toBeLessThan(4000);
      }
    }
    expect(new Set(table.functionalGroups.map((g) => g.id)).size).toBe(
      table.functionalGroups.length,
    );
    expect(table.metalOxides.map((m) => m.label)).toContain('TiO2 anatase');
  });
});

describe('suggestAssignments', () => {
  it('ranks a group whose range contains the peak above one that only lies near it', () => {
    const [best, ...rest] = suggestAssignments(1730, table);
    expect(best?.distance).toBe(0);
    expect(best?.label).toContain('C=O');
    expect(best?.reason).toContain('inside the typical range');
    expect(rest.every((s) => s.distance >= (best?.distance ?? 0))).toBe(true);
  });

  it('suggests nothing far from every range, and respects the tolerance', () => {
    const none = suggestAssignments(2000, {
      functionalGroups: [{ id: 'a', label: 'x', ranges: [{ from: 1700, to: 1750 }] }],
      metalOxides: [],
    });
    expect(none).toEqual([]);
    const near = suggestAssignments(
      1760,
      {
        functionalGroups: [{ id: 'a', label: 'x', ranges: [{ from: 1700, to: 1750 }] }],
        metalOxides: [],
      },
      DEFAULT_TOLERANCE_CM,
    );
    expect(near[0]?.distance).toBe(10);
    expect(near[0]?.reason).toContain('outside');
    expect(
      suggestAssignments(
        1760,
        {
          functionalGroups: [{ id: 'a', label: 'x', ranges: [{ from: 1700, to: 1750 }] }],
          metalOxides: [],
        },
        5,
      ),
    ).toEqual([]);
  });

  it('matches metal oxide bands from the table', () => {
    const zno = table.metalOxides.find((m) => m.label === 'ZnO');
    const band = zno?.bands[0]?.cm ?? 0;
    const hits = suggestAssignments(band + 3, {
      functionalGroups: [],
      metalOxides: table.metalOxides,
    });
    expect(hits.some((h) => h.id === zno?.id && h.kind === 'oxide')).toBe(true);
    expect(hits[0]?.reason).toContain('listed for');
  });
});
