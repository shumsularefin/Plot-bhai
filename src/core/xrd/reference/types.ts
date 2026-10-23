/** Shapes of the generated reference-library JSON files in data/reference/. */

export interface ReferencePeak {
  /** d-spacing, Å. */
  d: number;
  /** Number of reflections (both signs of h k l) sharing this line. */
  m: number;
  /** Σ|F|² over those reflections (electron units², scale arbitrary but fixed within a phase). */
  mf2: number;
  /** Relative intensity for Cu Kα1, strongest line = 100. */
  i: number;
  /** One (h k l) per symmetry-distinct family in the line. */
  hkl: [number, number, number][];
}

export interface ReferencePhase {
  /** Short id, unique in the library, for example "anatase". */
  id: string;
  name: string;
  /** Chemical formula as typed in the build configuration, for example "TiO2". */
  formula: string;
  /** Crystallography Open Database entry the pattern was computed from. */
  codId: number;
  spaceGroup: { hm: string; number: number };
  crystalSystem: string;
  /** Cell edges in Å and angles in degrees, from the CIF. */
  cell: { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };
  /** Literature reference given in the CIF. */
  citation: { journal: string; volume: string; page: string; year: string; doi: string | null };
  /** Peaks with d ≥ 0.8 Å, from the largest d. */
  peaks: ReferencePeak[];
}

export interface ReferenceFamilyFile {
  family: string;
  phases: ReferencePhase[];
}

export interface ReferenceIndexEntry {
  id: string;
  name: string;
  aliases: string[];
  formula: string;
  file: string;
  phases: { id: string; name: string; codId: number; spaceGroup: string; crystalSystem: string }[];
}

export interface ReferenceIndex {
  /** What the data are and where they come from. */
  source: string;
  /** Wavelength (Å) used for the stored relative intensities. */
  intensityWavelength: number;
  families: ReferenceIndexEntry[];
}
