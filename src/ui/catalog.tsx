import type { ComponentChildren } from 'preact';

/** A tool on the home page, grouped by technique family. */
export interface ToolEntry {
  name: string;
  /** Typical file types, shown as a badge. */
  badge: string;
  /** Two or three headline methods, shown under the name. */
  features: string;
  /** One sentence for the search results and screen readers. */
  description: string;
  href: string;
  /** Line drawing, 48 × 48 units. */
  icon: ComponentChildren;
  /** For a tool reached through several entries: links shown as chips instead of one link. */
  links?: readonly { label: string; href: string }[];
}

export interface ToolGroup {
  title: string;
  tools: readonly ToolEntry[];
}

export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    title: 'Diffraction',
    tools: [
      {
        name: 'XRD Analysis',
        badge: '.CIF / .XY',
        features: 'CIF, Rietveld, Scherrer',
        description:
          'Clean a diffraction pattern, compare reference phases, fit peaks and work out crystallite size and strain.',
        href: '#/xrd',
        icon: <path d="M4 42h40M5 40V6M5 40h3l2-14 2 14h2l3-30 3 30h2l2-18 2 18h3l2-10 2 10h4" />,
      },
      {
        name: 'Plot Digitizer',
        badge: '.PNG / .JPG',
        features: 'Log/Linear Axes, Calibration',
        description:
          'Only have a figure from a paper? Calibrate its axes, trace the curve and analyse it in any tool.',
        href: '#/xrd/image',
        icon: (
          <>
            <path d="M6 42V6M3 9l3-3 3 3M6 42h36M39 39l3 3-3 3M10 38l28-26" />
            <circle cx="15" cy="30" r="2" />
            <circle cx="21" cy="22" r="2" />
            <circle cx="28" cy="25" r="2" />
            <circle cx="33" cy="14" r="2" />
          </>
        ),
        links: [
          { label: 'XRD', href: '#/xrd/image' },
          { label: 'FTIR', href: '#/ftir/image' },
          { label: 'UV-Vis', href: '#/uvvis/image' },
          { label: 'TGA/DSC', href: '#/thermal/image' },
        ],
      },
    ],
  },
  {
    title: 'Spectroscopy',
    tools: [
      {
        name: 'UV-Vis & Tauc',
        badge: '.DAT / .CSV',
        features: 'Band Gap, Film Optics',
        description:
          'Absorbance, transmittance and reflectance spectra, Tauc band gaps, concentration and thin films.',
        href: '#/uvvis',
        icon: <path d="M5 42h38M5 40V6M6 10c4 0 5 3 7 9s4 14 10 18 12 3 19 3" />,
      },
      {
        name: 'FTIR & ATR',
        badge: '.CSV / .SPA',
        features: 'Functional Groups, Deconvolution',
        description:
          'Absorbance and transmittance spectra, peak tables, band fitting and functional group suggestions.',
        href: '#/ftir',
        icon: <path d="M5 42h38M5 40V6M6 8h3l2 22 3-22h2l2 12 3-12h2l3 26 3-26h2l2 9 2-9h5" />,
      },
    ],
  },
  {
    title: 'Thermal analysis',
    tools: [
      {
        name: 'Thermal TGA & DSC',
        badge: '.TXT / .CSV',
        features: 'Kinetics, Glass Transition',
        description:
          'Mass loss steps, thermal events, enthalpies, glass transition, calcination suggestions and activation energy.',
        href: '#/thermal',
        icon: <path d="M5 42h38M5 40V6M6 9h12c4 0 4 2 5 9s2 13 7 14h14" />,
      },
    ],
  },
  {
    title: 'Microscopy & utilities',
    tools: [
      {
        name: 'Particle Size SEM/TEM',
        badge: '.TIF / .PNG',
        features: 'Watershed, Stereology',
        description: 'Measure particles in SEM or TEM images and build a size distribution.',
        href: '#/particles',
        icon: (
          <>
            <circle cx="12" cy="13" r="4" />
            <circle cx="24" cy="9" r="3" />
            <circle cx="34" cy="14" r="3.5" />
            <circle cx="18" cy="24" r="3" />
            <circle cx="29" cy="25" r="5" />
            <circle cx="11" cy="34" r="3.5" />
            <circle cx="22" cy="37" r="3" />
            <circle cx="37" cy="35" r="2.5" />
          </>
        ),
      },
      {
        name: 'Sample Report',
        badge: '.PDF / .HTML',
        features: 'Unified Printable Brief',
        description:
          'One sample, several techniques: every analysis in one summary with a single methods section.',
        href: '#/report',
        icon: <path d="M11 4h18l9 9v31H11zM29 4v9h9M17 36l6-7 5 4 7-9M17 22h8" />,
      },
    ],
  },
];

/** Extra search terms that lead to a tool (methods people search for by name). */
const KEYWORDS: Record<string, string> = {
  '#/xrd':
    'diffraction powder phase cod reference williamson hall size strain lattice indexing le bail rietveld scherrer hkl crystallinity',
  '#/xrd/image': 'digitise digitize screenshot figure picture graph trace curve paper',
  '#/uvvis':
    'band gap tauc absorbance transmittance reflectance kubelka munk urbach concentration beer lambert kinetics plasmon thin film thickness',
  '#/ftir': 'infrared absorbance transmittance peaks bands functional groups atr deconvolution',
  '#/thermal':
    'tga dsc dtg mass loss heat flow enthalpy glass transition calcination kissinger ozawa friedman activation energy oit purity cp',
  '#/particles': 'sem tem image size distribution histogram watershed stereology feret',
  '#/report': 'summary combine pdf html methods',
};

export interface SearchItem {
  title: string;
  detail: string;
  href: string;
  terms: string;
}

export const SEARCH_ITEMS: readonly SearchItem[] = [
  ...TOOL_GROUPS.flatMap((g) =>
    g.tools.flatMap((t) => [
      {
        title: t.name,
        detail: `${g.title} · ${t.features}`,
        href: t.href,
        terms: `${t.name} ${t.features} ${t.description} ${KEYWORDS[t.href] ?? ''}`,
      },
      ...(t.links ?? [])
        .filter((l) => l.href !== t.href)
        .map((l) => ({
          title: `${l.label} from a graph image`,
          detail: 'Plot Digitizer',
          href: l.href,
          terms: `${l.label} ${KEYWORDS['#/xrd/image']}`,
        })),
    ]),
  ),
  {
    title: 'How it is validated',
    detail: 'Checks, tolerances and open items',
    href: '#/validation',
    terms: 'validation checks tests accuracy',
  },
  {
    title: 'About, equations and limits',
    detail: 'Documentation',
    href: '#/about',
    terms: 'about equations documentation limits privacy cite citation credits',
  },
];

/** Items whose words contain every word typed, best (title) matches first. */
export function searchItems(query: string): SearchItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const score = (item: SearchItem) => {
    const title = item.title.toLowerCase();
    const all = `${title} ${item.terms.toLowerCase()}`;
    if (!words.every((w) => all.includes(w))) return -1;
    return words.filter((w) => title.includes(w)).length;
  };
  return SEARCH_ITEMS.map((item) => ({ item, s: score(item) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.item);
}
