/**
 * The tool last opened, so the home page can offer to pick up where you left off. Each tool
 * saves its own work in this browser; this only remembers which one was in use, and when.
 */
const KEY = 'plot-last-session';

export const TOOL_NAMES: Record<string, string> = {
  '/xrd': 'XRD analysis',
  '/ftir': 'FTIR analysis',
  '/uvvis': 'UV-Vis analysis',
  '/thermal': 'Thermal analysis (TGA & DSC)',
  '/particles': 'Particle size from images',
  '/xrd/image': 'XRD pattern from a graph image',
  '/ftir/image': 'FTIR spectrum from a graph image',
  '/uvvis/image': 'UV-Vis spectrum from a graph image',
  '/thermal/image': 'Thermal curve from a graph image',
};

export interface LastSession {
  path: string;
  name: string;
  at: number;
}

export function recordSession(path: string, now = Date.now()): void {
  if (!(path in TOOL_NAMES)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: now }));
  } catch {
    // Storage can be full or blocked; the resume bar is a convenience.
  }
}

export function readSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof value.path !== 'string' || typeof value.at !== 'number') return null;
    const name = TOOL_NAMES[value.path];
    return name ? { path: value.path, name, at: value.at } : null;
  } catch {
    return null;
  }
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export function timeAgo(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return 'just now';
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  return plural(Math.round(hours / 24), 'day');
}
