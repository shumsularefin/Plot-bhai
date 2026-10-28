/** The thermal tool shows one of four wizards; the choice is remembered in this browser. */
export type Technique = 'tga' | 'dsc' | 'dsc-methods' | 'kinetics';

const KEY = 'thermal-technique';

export function savedTechnique(): Technique {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'dsc' || saved === 'dsc-methods' || saved === 'kinetics' ? saved : 'tga';
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
