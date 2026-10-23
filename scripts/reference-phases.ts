/*
 * The materials and phases of the reference library (CLAUDE.md stage 6a). Each phase is a
 * search request to the Crystallography Open Database, not a COD ID: the build script picks
 * the entry. `mineral` and `spaceGroup` are filters that separate polymorphs; they are
 * checked against what COD itself reports for each entry, and the chosen entry's own values
 * are what end up in the library.
 */

export interface PhaseRequest {
  /** Unique short id. */
  id: string;
  /** Library file the phase goes into (one JSON per family). */
  family: string;
  name: string;
  /** Formula as element/count pairs, for example "TiO2"; compared after reducing common factors. */
  formula: string;
  /** Required match against COD's mineral, common name or chemical name fields. */
  mineral?: RegExp;
  /** Required COD space-group number (International Tables); a list allows enantiomorphic pairs. */
  spaceGroup?: number | number[];
}

export interface FamilyInfo {
  id: string;
  name: string;
  /** Extra search words: names and formulas people might type. */
  aliases: string[];
  formula: string;
}

export const FAMILIES: FamilyInfo[] = [
  {
    id: 'tio2',
    name: 'Titanium dioxide',
    aliases: ['titania', 'titanium oxide', 'TiO2'],
    formula: 'TiO2',
  },
  { id: 'zno', name: 'Zinc oxide', aliases: ['zincite', 'zinc oxide', 'ZnO'], formula: 'ZnO' },
  {
    id: 'iron-oxides',
    name: 'Iron oxides',
    aliases: ['magnetite', 'hematite', 'maghemite', 'Fe3O4', 'Fe2O3', 'iron oxide'],
    formula: 'Fe-O',
  },
  {
    id: 'copper-oxides',
    name: 'Copper oxides',
    aliases: ['tenorite', 'cuprite', 'CuO', 'Cu2O', 'copper oxide'],
    formula: 'Cu-O',
  },
  {
    id: 'nio',
    name: 'Nickel oxide',
    aliases: ['bunsenite', 'NiO', 'nickel oxide'],
    formula: 'NiO',
  },
  {
    id: 'co3o4',
    name: 'Cobalt oxide',
    aliases: ['cobalt(II,III) oxide', 'Co3O4', 'cobalt oxide'],
    formula: 'Co3O4',
  },
  {
    id: 'ceo2',
    name: 'Cerium dioxide',
    aliases: ['ceria', 'cerianite', 'CeO2', 'cerium oxide'],
    formula: 'CeO2',
  },
  {
    id: 'sno2',
    name: 'Tin dioxide',
    aliases: ['cassiterite', 'SnO2', 'tin oxide'],
    formula: 'SnO2',
  },
  { id: 'wo3', name: 'Tungsten trioxide', aliases: ['WO3', 'tungsten oxide'], formula: 'WO3' },
  {
    id: 'al2o3',
    name: 'Aluminium oxide',
    aliases: ['alumina', 'corundum', 'Al2O3', 'aluminum oxide'],
    formula: 'Al2O3',
  },
  { id: 'sio2', name: 'Silicon dioxide', aliases: ['quartz', 'silica', 'SiO2'], formula: 'SiO2' },
  {
    id: 'cds',
    name: 'Cadmium sulfide',
    aliases: ['greenockite', 'hawleyite', 'CdS', 'cadmium sulphide'],
    formula: 'CdS',
  },
  {
    id: 'zns',
    name: 'Zinc sulfide',
    aliases: ['sphalerite', 'wurtzite', 'ZnS', 'zinc blende', 'zinc sulphide'],
    formula: 'ZnS',
  },
  { id: 'batio3', name: 'Barium titanate', aliases: ['BaTiO3'], formula: 'BaTiO3' },
  { id: 'srtio3', name: 'Strontium titanate', aliases: ['tausonite', 'SrTiO3'], formula: 'SrTiO3' },
  {
    id: 'caco3',
    name: 'Calcium carbonate',
    aliases: ['calcite', 'aragonite', 'CaCO3', 'limestone'],
    formula: 'CaCO3',
  },
  {
    id: 'mos2',
    name: 'Molybdenum disulfide',
    aliases: ['molybdenite', 'MoS2', 'molybdenum disulphide'],
    formula: 'MoS2',
  },
  { id: 'graphite', name: 'Graphite', aliases: ['carbon', 'C'], formula: 'C' },
  { id: 'si', name: 'Silicon', aliases: ['Si'], formula: 'Si' },
  {
    id: 'lab6',
    name: 'Lanthanum hexaboride',
    aliases: ['LaB6', 'NIST 660', 'line position standard'],
    formula: 'LaB6',
  },
  { id: 'au', name: 'Gold', aliases: ['Au'], formula: 'Au' },
  { id: 'ag', name: 'Silver', aliases: ['Ag'], formula: 'Ag' },
  { id: 'cu', name: 'Copper', aliases: ['Cu'], formula: 'Cu' },
  { id: 'pt', name: 'Platinum', aliases: ['Pt'], formula: 'Pt' },
  { id: 'ni', name: 'Nickel', aliases: ['Ni'], formula: 'Ni' },
];

export const PHASES: PhaseRequest[] = [
  {
    id: 'anatase',
    family: 'tio2',
    name: 'Anatase',
    formula: 'TiO2',
    mineral: /anatase/i,
    spaceGroup: 141,
  },
  {
    id: 'rutile',
    family: 'tio2',
    name: 'Rutile',
    formula: 'TiO2',
    mineral: /rutile/i,
    spaceGroup: 136,
  },
  {
    id: 'brookite',
    family: 'tio2',
    name: 'Brookite',
    formula: 'TiO2',
    mineral: /brookite/i,
    spaceGroup: 61,
  },
  {
    id: 'zno-wurtzite',
    family: 'zno',
    name: 'Zincite (wurtzite)',
    formula: 'ZnO',
    spaceGroup: 186,
  },
  {
    id: 'magnetite',
    family: 'iron-oxides',
    name: 'Magnetite',
    formula: 'Fe3O4',
    mineral: /magnetite/i,
    spaceGroup: 227,
  },
  {
    id: 'hematite',
    family: 'iron-oxides',
    name: 'Hematite (α-Fe2O3)',
    formula: 'Fe2O3',
    mineral: /hematite/i,
    spaceGroup: 167,
  },
  {
    id: 'maghemite',
    family: 'iron-oxides',
    name: 'Maghemite (γ-Fe2O3)',
    formula: 'Fe2O3',
    mineral: /maghemite/i,
    spaceGroup: 225,
  },
  {
    id: 'tenorite',
    family: 'copper-oxides',
    name: 'Tenorite (CuO)',
    formula: 'CuO',
    mineral: /tenorite/i,
    spaceGroup: 15,
  },
  {
    id: 'cuprite',
    family: 'copper-oxides',
    name: 'Cuprite (Cu2O)',
    formula: 'Cu2O',
    mineral: /cuprite/i,
    spaceGroup: 224,
  },
  {
    id: 'nio',
    family: 'nio',
    name: 'Bunsenite (NiO)',
    formula: 'NiO',
    mineral: /bunsenite/i,
    spaceGroup: 225,
  },
  {
    id: 'co3o4',
    family: 'co3o4',
    name: 'Cobalt(II,III) oxide (spinel)',
    formula: 'Co3O4',
    spaceGroup: 227,
  },
  { id: 'ceo2', family: 'ceo2', name: 'Cerianite (CeO2)', formula: 'CeO2', spaceGroup: 225 },
  {
    id: 'sno2',
    family: 'sno2',
    name: 'Cassiterite (SnO2)',
    formula: 'SnO2',
    mineral: /cassiterite/i,
    spaceGroup: 136,
  },
  { id: 'wo3-monoclinic', family: 'wo3', name: 'WO3 (monoclinic)', formula: 'WO3', spaceGroup: 14 },
  {
    id: 'corundum',
    family: 'al2o3',
    name: 'Corundum (α-Al2O3)',
    formula: 'Al2O3',
    mineral: /corundum/i,
    spaceGroup: 167,
  },
  { id: 'gamma-al2o3', family: 'al2o3', name: 'γ-Al2O3', formula: 'Al2O3', spaceGroup: 227 },
  {
    id: 'alpha-quartz',
    family: 'sio2',
    name: 'α-Quartz',
    formula: 'SiO2',
    mineral: /^quartz/i,
    spaceGroup: [152, 154],
  },
  {
    id: 'cds-hexagonal',
    family: 'cds',
    name: 'Greenockite (hexagonal CdS)',
    formula: 'CdS',
    spaceGroup: 186,
  },
  {
    id: 'cds-cubic',
    family: 'cds',
    name: 'Hawleyite (cubic CdS)',
    formula: 'CdS',
    spaceGroup: 216,
  },
  {
    id: 'zns-sphalerite',
    family: 'zns',
    name: 'Sphalerite (cubic ZnS)',
    formula: 'ZnS',
    spaceGroup: 216,
  },
  {
    id: 'zns-wurtzite',
    family: 'zns',
    name: 'Wurtzite (hexagonal ZnS)',
    formula: 'ZnS',
    spaceGroup: 186,
  },
  {
    id: 'batio3-tetragonal',
    family: 'batio3',
    name: 'BaTiO3 (tetragonal)',
    formula: 'BaTiO3',
    spaceGroup: 99,
  },
  {
    id: 'batio3-cubic',
    family: 'batio3',
    name: 'BaTiO3 (cubic)',
    formula: 'BaTiO3',
    spaceGroup: 221,
  },
  {
    id: 'srtio3',
    family: 'srtio3',
    name: 'Strontium titanate (cubic)',
    formula: 'SrTiO3',
    spaceGroup: 221,
  },
  {
    id: 'calcite',
    family: 'caco3',
    name: 'Calcite',
    formula: 'CaCO3',
    mineral: /calcite/i,
    spaceGroup: 167,
  },
  {
    id: 'aragonite',
    family: 'caco3',
    name: 'Aragonite',
    formula: 'CaCO3',
    mineral: /aragonite/i,
    spaceGroup: 62,
  },
  {
    id: 'mos2-2h',
    family: 'mos2',
    name: 'Molybdenite-2H (MoS2)',
    formula: 'MoS2',
    spaceGroup: 194,
  },
  { id: 'graphite', family: 'graphite', name: 'Graphite (2H)', formula: 'C', spaceGroup: 194 },
  { id: 'si', family: 'si', name: 'Silicon', formula: 'Si', spaceGroup: 227 },
  { id: 'lab6', family: 'lab6', name: 'Lanthanum hexaboride', formula: 'LaB6', spaceGroup: 221 },
  { id: 'au', family: 'au', name: 'Gold (fcc)', formula: 'Au', spaceGroup: 225 },
  { id: 'ag', family: 'ag', name: 'Silver (fcc)', formula: 'Ag', spaceGroup: 225 },
  { id: 'cu', family: 'cu', name: 'Copper (fcc)', formula: 'Cu', spaceGroup: 225 },
  { id: 'pt', family: 'pt', name: 'Platinum (fcc)', formula: 'Pt', spaceGroup: 225 },
  { id: 'ni', family: 'ni', name: 'Nickel (fcc)', formula: 'Ni', spaceGroup: 225 },
];
