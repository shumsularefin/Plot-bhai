import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import './dock.css';

/*
 * Keeps one plot (or image) in view while the settings above or below it are changed: beside the
 * page on wide screens, as a panel along the bottom on narrow ones. Only one figure on a page is
 * kept in view at a time: the one the user picked, otherwise the first that asks for it. Whether
 * plots are kept in view at all is a per-browser preference, like the open state of Advanced
 * sections; nothing about the analysis changes.
 */

const PREF_KEY = 'plot-dock';

function readPref(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}

interface DockState {
  enabled: boolean;
  collapsed: boolean;
  /** Figures that dock on their own, in mount order. */
  auto: string[];
  /** Every mounted figure. */
  mounted: Set<string>;
  chosen: string | null;
}

const state: DockState = {
  enabled: readPref(PREF_KEY, true),
  collapsed: readPref(`${PREF_KEY}-collapsed`, false),
  auto: [],
  mounted: new Set(),
  chosen: null,
};
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** The figure kept in view now, or null. */
function active(): string | null {
  if (!state.enabled) return null;
  if (state.chosen !== null && state.mounted.has(state.chosen)) return state.chosen;
  return state.auto[0] ?? null;
}

function setEnabled(enabled: boolean) {
  state.enabled = enabled;
  writePref(PREF_KEY, enabled);
  notify();
}

function setCollapsed(collapsed: boolean) {
  state.collapsed = collapsed;
  writePref(`${PREF_KEY}-collapsed`, collapsed);
  notify();
}

/** Re-renders on every change of the shared dock state. */
function useDockState() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

interface DockProps {
  /** Name of the figure, read out by screen readers and shown on the panel's bar. */
  label: string;
  /**
   * 'auto' (the default) docks the figure when it is the first on the page; 'manual' only when
   * the user asks, for figures inside closed sections or secondary checks.
   */
  mode?: 'auto' | 'manual';
  children: ComponentChildren;
}

/** A figure that can be kept in view while the page scrolls (see the comment at the top). */
export function Dock({ label, mode = 'auto', children }: DockProps) {
  const id = useId();
  useDockState();
  useEffect(() => {
    state.mounted.add(id);
    if (mode === 'auto') state.auto.push(id);
    notify();
    return () => {
      state.mounted.delete(id);
      state.auto = state.auto.filter((a) => a !== id);
      if (state.chosen === id) state.chosen = null;
      notify();
    };
  }, [id, mode]);

  const docked = active() === id;
  const collapsed = docked && state.collapsed;
  const frame = useRef<HTMLDivElement>(null);

  // The page leaves room for the panel: a class on the root element, and the panel's height for
  // the bottom panel on narrow screens.
  useEffect(() => {
    const root = globalThis.document?.documentElement;
    if (!docked || !root) return;
    root.classList.add('has-dock');
    root.classList.toggle('dock-collapsed', collapsed);
    const element = frame.current;
    const observer =
      element && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() =>
            root.style.setProperty('--dock-height', `${element.offsetHeight}px`),
          )
        : null;
    if (element) {
      root.style.setProperty('--dock-height', `${element.offsetHeight}px`);
      observer?.observe(element);
    }
    return () => {
      observer?.disconnect();
      root.classList.remove('has-dock', 'dock-collapsed');
      root.style.removeProperty('--dock-height');
    };
  }, [docked, collapsed]);

  return (
    <div class="dock-slot">
      {docked && (
        <p class="dock-placeholder">
          This figure is kept in view while you change the settings.{' '}
          <button type="button" class="btn btn-quiet" onClick={() => setEnabled(false)}>
            Show it here instead
          </button>
        </p>
      )}
      <div
        ref={frame}
        class={docked ? `dock-frame${collapsed ? ' is-collapsed' : ''}` : 'dock-inline'}
        {...(docked && { role: 'region', 'aria-label': `${label} (kept in view)` })}
      >
        {docked && (
          <div class="dock-bar">
            <span class="dock-title">{label}</span>
            <button
              type="button"
              class="btn btn-quiet"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? 'Expand' : 'Minimise'}
            </button>
            <button type="button" class="btn btn-quiet" onClick={() => setEnabled(false)}>
              Unpin
            </button>
          </div>
        )}
        <div class="dock-content" hidden={collapsed}>
          {children}
        </div>
      </div>
      {!docked && (
        <button
          type="button"
          class="btn btn-quiet dock-pin"
          onClick={() => {
            state.chosen = id;
            setEnabled(true);
          }}
        >
          Keep this figure in view
        </button>
      )}
    </div>
  );
}
