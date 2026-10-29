/*
 * The polymer library (structures that COD does not hold). Each phase is a CIF in data/polymers/
 * transcribed by hand from the paper it cites; the transcription checks are in
 * docs/polymer-library.md. Polymers that COD does hold (cellulose I alpha and I beta, alpha- and
 * beta-chitin, V-amylose, isotactic polypropylene) are found through the COD search instead.
 */

export interface PolymerFamily {
  id: string;
  name: string;
  /** Extra search words: names and abbreviations people might type. */
  aliases: string[];
  phases: { id: string; file: string; name: string; authors: string }[];
}

export const POLYMER_FAMILIES: PolymerFamily[] = [
  {
    id: 'cellulose',
    name: 'Cellulose',
    aliases: ['cellulose', 'mercerized cellulose', 'regenerated cellulose', 'nanocellulose'],
    phases: [
      {
        id: 'cellulose-ii',
        file: 'cellulose-ii.cif',
        name: 'Cellulose II',
        authors: 'Langan et al.',
      },
      {
        id: 'cellulose-iii-i',
        file: 'cellulose-iii-i.cif',
        name: 'Cellulose III(I)',
        authors: 'Wada et al.',
      },
    ],
  },
  {
    id: 'starch',
    name: 'Starch (amylose)',
    aliases: ['starch', 'amylose', 'A-type starch', 'cereal starch'],
    phases: [
      { id: 'a-amylose', file: 'a-amylose.cif', name: 'A-amylose', authors: 'Popov et al.' },
    ],
  },
  {
    id: 'alginate',
    name: 'Alginate',
    aliases: ['alginate', 'alginic acid', 'guluronic acid', 'G-block', 'sodium alginate'],
    phases: [
      {
        id: 'polyguluronic-acid',
        file: 'polyguluronic-acid.cif',
        name: 'Poly-α-L-guluronic acid',
        authors: 'Atkins et al.',
      },
    ],
  },
  {
    id: 'polyesters',
    name: 'Polyesters (PLA, PHB, PCL, PET)',
    aliases: [
      'PLA',
      'PLLA',
      'polylactide',
      'poly(lactic acid)',
      'PHB',
      'polyhydroxybutyrate',
      'PCL',
      'polycaprolactone',
      'PET',
      'polyethylene terephthalate',
      'polyester',
    ],
    phases: [
      {
        id: 'plla-alpha',
        file: 'plla-alpha.cif',
        name: 'Poly(L-lactic acid), α form',
        authors: 'Wasanasuk et al.',
      },
      { id: 'phb', file: 'phb.cif', name: 'Poly(3-hydroxybutyrate)', authors: 'Yokouchi et al.' },
      { id: 'pcl', file: 'pcl.cif', name: 'Poly(ε-caprolactone)', authors: 'Chatani et al.' },
      {
        id: 'pet',
        file: 'pet.cif',
        name: 'Poly(ethylene terephthalate)',
        authors: 'Daubeny et al.',
      },
    ],
  },
  {
    id: 'peo',
    name: 'Poly(ethylene oxide)',
    aliases: ['PEO', 'PEG', 'polyethylene glycol', 'polyethylene oxide'],
    phases: [
      { id: 'peo', file: 'peo.cif', name: 'Poly(ethylene oxide)', authors: 'Takahashi & Tadokoro' },
    ],
  },
  {
    id: 'pva',
    name: 'Poly(vinyl alcohol)',
    aliases: ['PVA', 'PVOH', 'polyvinyl alcohol'],
    phases: [{ id: 'pva', file: 'pva.cif', name: 'Poly(vinyl alcohol)', authors: 'Bunn' }],
  },
  {
    id: 'pvdf',
    name: 'Poly(vinylidene fluoride)',
    aliases: ['PVDF', 'polyvinylidene fluoride', 'PVF2'],
    phases: [
      {
        id: 'pvdf-alpha',
        file: 'pvdf-alpha.cif',
        name: 'PVDF, α phase (form II)',
        authors: 'Hasegawa et al.',
      },
      {
        id: 'pvdf-beta',
        file: 'pvdf-beta.cif',
        name: 'PVDF, β phase (form I)',
        authors: 'Hasegawa et al.',
      },
    ],
  },
  {
    id: 'nylon',
    name: 'Polyamides (nylon)',
    aliases: ['nylon', 'nylon 6', 'polyamide', 'PA6', 'polycaproamide'],
    phases: [
      {
        id: 'nylon6-alpha',
        file: 'nylon6-alpha.cif',
        name: 'Nylon 6, α form',
        authors: 'Holmes et al.',
      },
    ],
  },
];
