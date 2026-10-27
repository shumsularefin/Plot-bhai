/** The thermal tool shows one of three wizards; the choice is remembered in this browser. */
export type Technique = 'tga' | 'dsc' | 'kinetics';

const KEY = 'thermal-technique';

export function savedTechnique(): Technique {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'dsc' || saved === 'kinetics' ? saved : 'tga';
  } catch {
    return 'tga';
  }
}

export function saveTechnique(technique: Technique): void {
  try {
    localStorage.setItem(KEY, technique);
  } catch {
    // The choice just is not remembered.
  }
}
