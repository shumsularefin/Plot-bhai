// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOLERANCE_CM, suggestAssignments, type GroupTable } from '../src/core/ftir/assign';
import {
  formulas,
  parseAlAmin,
  parseElgayyar,
  parseFunctionalGroups,
  parseGautam,
  parseMetalOxides,
  parseRanges,
  tableWrap,
} from '../scripts/ftir-groups-parse';
import {
  addedFunctionalGroups,
  addedMetalOxides,
  addedSources,
} from '../scripts/ftir-groups-added';

const table = JSON.parse(
  readFileSync(new URL('../data/ftir/groups.json', import.meta.url), 'utf8'),
) as GroupTable;
const source = (name: string) =>
  readFileSync(new URL(`../data/ftir/source/${name}`, import.meta.url), 'utf8');
const cached = source('tables.xml');
const rowsOf = (key: string) => table.functionalGroups.filter((g) => g.source === key);

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
    const groups = parseFunctionalGroups(tableWrap(cached, 1) ?? '', 'pasieczna-2025');
    const oxides = parseMetalOxides(tableWrap(cached, 0) ?? '', 'pasieczna-2025');
    expect(rowsOf('pasieczna-2025')).toEqual(groups);
    expect(table.metalOxides.filter((m) => m.source === 'pasieczna-2025')).toEqual(oxides);
    expect(groups.length).toBe(65);
    expect(rowsOf('al-amin-2025')).toEqual(
      parseAlAmin(source('al-amin-2025-table1.txt'), 'al-amin-2025'),
    );
    expect(rowsOf('elgayyar-2025')).toEqual(
      parseElgayyar(source('elgayyar-2025-table1.txt'), 'elgayyar-2025'),
    );
    expect(rowsOf('gautam-2012')).toEqual(
      parseGautam(source('gautam-2012-table6.txt'), 'gautam-2012'),
    );
    // Row counts of the printed tables (Gautam's "<600" row has no lower limit and is left out).
    expect(rowsOf('al-amin-2025')).toHaveLength(27);
    expect(rowsOf('elgayyar-2025')).toHaveLength(4);
    expect(rowsOf('gautam-2012')).toHaveLength(22);
    // The typed rows of scripts/ftir-groups-added.ts, unchanged.
    expect(table.functionalGroups.slice(-addedFunctionalGroups.length)).toEqual(
      addedFunctionalGroups,
    );
    expect(table.metalOxides.slice(-addedMetalOxides.length)).toEqual(addedMetalOxides);
    expect(rowsOf('socrates-2001')).toHaveLength(17);
    expect(rowsOf('kaaouass-2024')).toHaveLength(5);
  });

  it('every row names a source with a citation, a licence and a verification note', () => {
    expect(Object.keys(table.sources)).toEqual([
      'pasieczna-2025',
      'al-amin-2025',
      'elgayyar-2025',
      'gautam-2012',
      ...Object.keys(addedSources),
    ]);
    expect(table.sources['pasieczna-2025']?.doi).toBe('10.3390/molecules30030684');
    for (const [key, s] of Object.entries(table.sources)) {
      expect(s.verification).toContain('confirm a range against your own literature');
      if (key === 'socrates-2001') {
        // The book: no DOI, cited by ISBN, all rights reserved (only band positions are used).
        expect(s.doi).toBeUndefined();
        expect(s.citation).toContain('ISBN 0-471-85298-8');
        expect(s.licence).toMatch(/all rights reserved.*owner/);
        continue;
      }
      expect(s.doi).toMatch(/^10\./);
      // Open licences only; NoDerivatives (ND) would forbid the transcription.
      expect(s.licence).toMatch(/CC BY/);
      expect(s.licence).not.toMatch(/ND/);
    }
    for (const key of ['kaaouass-2024', 'bishop-2021', 'luo-2022'])
      expect(table.sources[key]?.licence).toMatch(/^CC BY-NC 4\.0/);
    for (const row of [...table.functionalGroups, ...table.metalOxides])
      expect(table.sources[row.source]).toBeTruthy();
  });

  it('has sane numbers and unique ids', () => {
    for (const g of table.functionalGroups) {
      expect(g.ranges.length).toBeGreaterThan(0);
      for (const r of g.ranges) {
        expect(r.from).toBeLessThanOrEqual(r.to);
        // Al-Amin et al. list metal–halide and metal–sulphur bands down to 150 cm⁻¹.
        expect(r.from).toBeGreaterThanOrEqual(g.source === 'al-amin-2025' ? 150 : 300);
        expect(r.to).toBeLessThan(4000);
      }
    }
    expect(new Set(table.functionalGroups.map((g) => g.id)).size).toBe(
      table.functionalGroups.length,
    );
    expect(new Set(table.metalOxides.map((m) => m.id)).size).toBe(table.metalOxides.length);
    expect(table.metalOxides.map((m) => m.label)).toContain('TiO2 anatase');
  });

  it('spot checks against the printed tables', () => {
    const find = (key: string, text: string) =>
      rowsOf(key).find((g) => g.label.includes(text))?.ranges;
    // Al-Amin et al., Table 1: the PDF font prints "=" as "]" and "≡" as "^".
    expect(find('al-amin-2025', 'S–H (thiol)')).toEqual([{ from: 2550, to: 2600 }]);
    expect(find('al-amin-2025', 'M=O (V=O, Mo=O)')).toEqual([{ from: 850, to: 1000 }]);
    expect(find('al-amin-2025', 'M≡N (metal–nitride)')).toEqual([{ from: 1000, to: 1100 }]);
    expect(find('al-amin-2025', 'N–O NO₃⁻ (nitrates), bending')).toEqual([{ from: 800, to: 850 }]);
    // Elgayyar et al., Table 1 (ν printed as "n").
    expect(find('elgayyar-2025', 'carbonate ν2, out-of-plane bend')).toEqual([
      { from: 850, to: 880 },
    ]);
    // Gautam et al., Table 6: "∼875" is approximate, "806" is not.
    const bo4 = rowsOf('gautam-2012').find((g) => g.label.includes('tetrahedral BO₄⁻'));
    expect(bo4).toMatchObject({ ranges: [{ from: 875, to: 875 }], approximate: true });
    const boroxol = rowsOf('gautam-2012').find((g) => g.label === 'Boroxol rings');
    expect(boroxol?.approximate).toBeUndefined();
    expect(rowsOf('gautam-2012').some((g) => g.label.includes('metallic cations'))).toBe(false);
    // Socrates 2001, Tables 4.1, 10.7 and 17.1 (pp. 83, 124, 234).
    expect(find('socrates-2001', 'monosubstituted (–C≡CH)')).toEqual([{ from: 2100, to: 2150 }]);
    expect(find('socrates-2001', 'Fermi resonance')).toEqual([{ from: 2650, to: 2745 }]);
    expect(find('socrates-2001', 'P=O stretch, unassociated')).toEqual([{ from: 1175, to: 1350 }]);
    // Kaaouass et al., Table 2: BO₄ stretching from 830 (MCBV4) to 888 (MCBV1) cm⁻¹.
    expect(find('kaaouass-2024', 'BO₄ unit stretching')).toEqual([{ from: 830, to: 888 }]);
    const mineral = (id: string) => table.metalOxides.find((m) => m.id === id)?.bands;
    // Bishop et al., Table 9 (calcite) and Table 10 (KNO₃), measured fundamentals.
    expect(mineral('bi-calcite')?.map((b) => b.cm)).toEqual([1420, 1067, 888, 716]);
    expect(mineral('bi-kno3')?.[0]).toEqual({ cm: 1424, note: 'NO₃⁻ ν3, asymmetric stretch' });
    // Luo et al., Table 1: 435.57 cm⁻¹ rounded; labelled as calculated.
    expect(mineral('lu-ceo2')?.[0]?.cm).toBe(436);
    expect(table.metalOxides.find((m) => m.id === 'lu-ceo2')?.label).toContain('calculated');
  });

  it('writes formulas back without touching other text', () => {
    expect(formulas('C–O (carbonates, CO32−)')).toBe('C–O (carbonates, CO₃²⁻)');
    expect(formulas('BO3 –O–BO4 bond-bending')).toBe('BO₃–O–BO₄ bond-bending');
    expect(formulas('groups containing BO3 −')).toBe('groups containing BO₃⁻');
    expect(formulas('B–O–M, M means metal ion')).toBe('B–O–M, M means metal ion');
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

  it('names the matched band when the table describes it', () => {
    const [calcite] = suggestAssignments(1420, {
      functionalGroups: [],
      metalOxides: table.metalOxides.filter((m) => m.id === 'bi-calcite'),
    });
    expect(calcite?.label).toBe('Calcite (CaCO₃), CO₃²⁻ ν3, asymmetric stretch');
    expect(calcite?.source).toBe('bishop-2021');
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

  it('names the source of each suggestion and keeps rows of sources that disagree', () => {
    // 890 cm⁻¹: Al-Amin et al. list C–O symmetric stretching of carbonate at 880–900 cm⁻¹,
    // Elgayyar et al. the out-of-plane bend (ν2) at 850–880 cm⁻¹. Both are offered.
    const suggestions = suggestAssignments(890, table, DEFAULT_TOLERANCE_CM, 20);
    const alAmin = suggestions.find((s) => s.label.includes('C–O (carbonates, CO₃²⁻), symmetric'));
    const elgayyar = suggestions.find((s) => s.label.startsWith('carbonate ν2'));
    expect(alAmin).toMatchObject({ source: 'al-amin-2025', distance: 0 });
    expect(elgayyar).toMatchObject({ source: 'elgayyar-2025', distance: 10 });
    expect(suggestions.every((s) => s.source === undefined || s.source in table.sources)).toBe(
      true,
    );
  });
});
