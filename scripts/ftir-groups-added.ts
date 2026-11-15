/*
 * Rows typed from four more sources, approved by the owner on 2026-11-15, read against the rendered
 * pages of the PDFs the owner supplied. They are typed here rather than parsed from cached text:
 * the Socrates book is all rights reserved, so its text may not be stored in this public
 * repository (only the band positions, with table and page, are used); Bishop et al. print their
 * tables as images; the Kaaouass et al. and Luo et al. tables are short. Each row names its table.
 */

const SAME_CHECK = 'confirm a range against your own literature before it goes into a paper.';

export const addedSources = {
  'socrates-2001': {
    short: 'Socrates 2001 (book), group frequency tables',
    citation:
      'G. Socrates, Infrared and Raman Characteristic Group Frequencies: Tables and Charts, 3rd edn, John Wiley & Sons, Chichester (2001), ISBN 0-471-85298-8',
    licence:
      'all rights reserved; band positions only, used with the owner’s approval (no text of the book is stored)',
    retrieved: '2026-11-15',
    tables:
      'Tables 4.1, 4.2 (alkynes), 10.7 (aldehydes), 14.1 (nitro), 15.1–15.3 (C–F, C–Cl, C–Br), 16.4 (sulphoxides), 17.1 (phosphorus)',
    verification: `Transcription checked on 2026-11-15: each of the 17 rows was read against the rendered book page named in its label. A textbook's typical ranges: ${SAME_CHECK}`,
  },
  'kaaouass-2024': {
    short: 'Kaaouass et al. 2024, Table 2 (Mn borovanadate glasses)',
    citation:
      'A. Kaaouass, A. Ben Ali, H. Ait Ahsaine, M. El Marssi, A. Lahmar, M. Saadi, "Manganese addition effect on structural and physical properties of calcium borovanadate glasses", Heliyon 10 (2024) e31219',
    doi: '10.1016/j.heliyon.2024.e31219',
    licence: 'CC BY-NC 4.0, https://creativecommons.org/licenses/by-nc/4.0/',
    url: 'https://doi.org/10.1016/j.heliyon.2024.e31219',
    retrieved: '2026-11-15',
    tables:
      'Table 2 (IR bands of xMn₂O₃–(30−x)V₂O₅–50B₂O₃–20CaO glasses); each range spans the five compositions',
    verification: `Transcription checked on 2026-11-15: the five IR rows match Table 2 of the PDF (the Raman rows are left out). Bands of one glass system: ${SAME_CHECK}`,
  },
  'bishop-2021': {
    short: 'Bishop et al. 2021, Tables 9 and 10 (carbonates, nitrates)',
    citation:
      'J. L. Bishop, S. J. King, M. D. Lane, A. J. Brown, B. Lafuente, T. Hiroi, R. Roberts, G. A. Swayze, J.-F. Lin, M. Sánchez Román, "Spectral Properties of Anhydrous Carbonates and Nitrates", Earth Space Sci. 8 (2021) e2021EA001844',
    doi: '10.1029/2021EA001844',
    licence: 'CC BY-NC 4.0, https://creativecommons.org/licenses/by-nc/4.0/',
    url: 'https://doi.org/10.1029/2021EA001844',
    retrieved: '2026-11-15',
    tables:
      'Table 9 (magnesite, calcite, aragonite) and Table 10 (LiNO₃, NaNO₃, KNO₃): measured fundamentals (Meas. cm⁻¹ column)',
    verification: `Transcription checked on 2026-11-15: the measured fundamental bands (ν1–ν4) of the six minerals match Tables 9 and 10 of the PDF, read against the rendered pages; overtones and combinations are left out. Bands of one sample of each mineral: ${SAME_CHECK}`,
  },
  'luo-2022': {
    short: 'Luo et al. 2022, Tables 1 and 3 (calculated, DFT)',
    citation:
      'G. Luo, W. Zhao, H. Guo, S. Gong, "Quantitative prediction of CeO₂ and LaAlO₃ infrared spectra based on first-principles calculations", RSC Adv. 12 (2022) 24055',
    doi: '10.1039/d2ra03539a',
    licence: 'CC BY-NC 4.0, https://creativecommons.org/licenses/by-nc/4.0/',
    url: 'https://doi.org/10.1039/d2ra03539a',
    retrieved: '2026-11-15',
    tables:
      'Table 1 (CeO₂) and Table 3 (LaAlO₃): calculated IR-active modes above 400 cm⁻¹, rounded to whole cm⁻¹',
    verification: `Transcription checked on 2026-11-15: the modes match Tables 1 and 3 of the PDF (the near-degenerate values of each mode, e.g. 435.57, 435.36 and 435.35 cm⁻¹, are given once). These are calculated, not measured, positions; the article quotes 450 cm⁻¹ measured for CeO₂: ${SAME_CHECK}`,
  },
};

type Row = [id: string, label: string, from: number, to: number];

/** Socrates 2001: [id, label with table and page, from, to] in cm⁻¹. */
const socrates: Row[] = [
  [
    'so-1-alkyne-mono',
    'Alkyne C≡C stretch, monosubstituted (–C≡CH) (Table 4.1, p. 83)',
    2100,
    2150,
  ],
  ['so-2-alkyne-di', 'Alkyne C≡C stretch, disubstituted (Table 4.1, p. 83)', 2190, 2260],
  ['so-3-alkyne-ch-str', '≡C–H stretch, monosubstituted alkynes (Table 4.2, p. 83)', 3280, 3340],
  ['so-4-alkyne-ch-def', '≡C–H deformation, alkynes (Table 4.2, p. 83)', 575, 730],
  ['so-5-aldehyde-ch', 'Aldehyde C–H stretch (Table 10.7, p. 124)', 2800, 2900],
  [
    'so-6-aldehyde-fermi',
    'Aldehyde C–H stretch, Fermi resonance band, usually near 2720 (Table 10.7, p. 124)',
    2650,
    2745,
  ],
  [
    'so-7-nitro-aliph-as',
    'Saturated aliphatic nitro, asymmetric NO₂ stretch (Table 14.1, p. 192)',
    1545,
    1555,
  ],
  [
    'so-8-nitro-aliph-s',
    'Saturated aliphatic nitro, symmetric NO₂ stretch (Table 14.1, p. 192)',
    1360,
    1385,
  ],
  ['so-9-nitro-arom-as', 'Aromatic nitro, asymmetric NO₂ stretch (Table 14.1, p. 192)', 1485, 1580],
  ['so-10-nitro-arom-s', 'Aromatic nitro, symmetric NO₂ stretch (Table 14.1, p. 192)', 1315, 1370],
  ['so-11-cf', 'C–F stretch (Table 15.1, p. 199)', 1000, 1400],
  ['so-12-ccl', 'C–Cl stretch (Table 15.2, p. 202)', 505, 760],
  ['so-13-cbr', 'C–Br stretch (Table 15.3, p. 204)', 485, 750],
  ['so-14-sulphoxide', 'Sulphoxide S=O stretch, dilute solution (Table 16.4, p. 215)', 1030, 1070],
  ['so-15-po-free', 'P=O stretch, unassociated (Table 17.1, p. 234)', 1175, 1350],
  ['so-16-po-assoc', 'P=O stretch, associated (Table 17.1, p. 234)', 1150, 1250],
  ['so-17-poc-alkyl', 'P–O–C stretch, alkyl phosphates (Table 17.1, p. 234)', 990, 1050],
];

/** Kaaouass et al. 2024, Table 2, IR rows: the range over the five glass compositions. */
const kaaouass: Row[] = [
  ['ka-1-mn-o', 'Mn–O vibration (Mn borovanadate glass)', 467, 467],
  ['ka-2-bob', 'B–O–B bond in the borate network (Mn borovanadate glass)', 623, 683],
  ['ka-3-bo4', 'BO₄ unit stretching (Mn borovanadate glass)', 830, 888],
  ['ka-4-diborovanadate', 'Diborovanadate groups (Mn borovanadate glass)', 1207, 1232],
  ['ka-5-bo3', 'B–O vibration in BO₃ units (Mn borovanadate glass)', 1318, 1332],
];

const toGroup =
  (source: string) =>
  ([id, label, from, to]: Row) => ({
    id,
    source,
    label,
    ranges: [{ from, to }],
  });

export const addedFunctionalGroups = [
  ...socrates.map(toGroup('socrates-2001')),
  ...kaaouass.map(toGroup('kaaouass-2024')),
];

/** Mode names as Bishop et al. define them in their abstract. */
const MODES: Record<string, string> = {
  ν1: 'symmetric stretch',
  ν2: 'out-of-plane bend',
  ν3: 'asymmetric stretch',
  ν4: 'in-plane bend',
  'ν4′': 'in-plane bend',
};
const bands = (anion: string, pairs: [number, string][]) =>
  pairs.map(([cm, mode]) => ({ cm, note: `${anion} ${mode}, ${MODES[mode]}` }));

export const addedMetalOxides = [
  {
    id: 'bi-magnesite',
    source: 'bishop-2021',
    label: 'Magnesite (MgCO₃)',
    bands: bands('CO₃²⁻', [
      [1434, 'ν3'],
      [1105, 'ν1'],
      [906, 'ν2'],
      [755, 'ν4'],
    ]),
  },
  {
    id: 'bi-calcite',
    source: 'bishop-2021',
    label: 'Calcite (CaCO₃)',
    bands: bands('CO₃²⁻', [
      [1420, 'ν3'],
      [1067, 'ν1'],
      [888, 'ν2'],
      [716, 'ν4'],
    ]),
  },
  {
    id: 'bi-aragonite',
    source: 'bishop-2021',
    label: 'Aragonite (CaCO₃)',
    bands: bands('CO₃²⁻', [
      [1475, 'ν3'],
      [1083, 'ν1'],
      [874, 'ν2'],
      [717, 'ν4'],
      [702, 'ν4′'],
    ]),
  },
  {
    id: 'bi-lino3',
    source: 'bishop-2021',
    label: 'Lithium nitrate (LiNO₃)',
    bands: bands('NO₃⁻', [
      [1442, 'ν3'],
      [1069, 'ν1'],
      [838, 'ν2'],
      [738, 'ν4'],
    ]),
  },
  {
    id: 'bi-nano3',
    source: 'bishop-2021',
    label: 'Sodium nitrate (NaNO₃)',
    bands: bands('NO₃⁻', [
      [1437, 'ν3'],
      [1094, 'ν1'],
      [827, 'ν2'],
      [726, 'ν4'],
    ]),
  },
  {
    id: 'bi-kno3',
    source: 'bishop-2021',
    label: 'Potassium nitrate (KNO₃)',
    bands: bands('NO₃⁻', [
      [1424, 'ν3'],
      [1049, 'ν1'],
      [824, 'ν2'],
      [715, 'ν4'],
      [696, 'ν4′'],
    ]),
  },
  {
    id: 'lu-ceo2',
    source: 'luo-2022',
    label: 'CeO₂ (calculated, DFT)',
    bands: [{ cm: 436, note: 'lattice mode, calculated (the article quotes 450 cm⁻¹ measured)' }],
  },
  {
    id: 'lu-laalo3',
    source: 'luo-2022',
    label: 'LaAlO₃ (calculated, DFT)',
    bands: [
      { cm: 646, note: 'lattice mode, calculated' },
      { cm: 402, note: 'lattice mode, calculated' },
    ],
  },
];
