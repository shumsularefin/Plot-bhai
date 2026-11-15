import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import {
  angle,
  BOND_TOLERANCE,
  bonds,
  cartesianMatrix,
  cellAtoms,
  type CellAtom,
  crystalFromStored,
  distance,
  toCartesian,
  type Vec3,
} from '../../core/xrd/structure/geometry';
import { hullFaces, outsideNeighbours } from '../../core/xrd/structure/polyhedra';
import covalent from '../../../data/reference/covalent-radii.json';
import { HelpTip } from '../../ui/HelpTip';

const RADII = (covalent as { radii: Record<string, number> }).radii;
/** Okabe–Ito colours (colour-blind safe), assigned to the elements in alphabetical order. */
const PALETTE = [
  '#E69F00',
  '#56B4E9',
  '#009E73',
  '#F0E442',
  '#0072B2',
  '#D55E00',
  '#CC79A7',
  '#999999',
];
const VIEW = 400;
/** Atoms beyond this are not focusable one by one, to keep keyboard use practical. */
const MAX_FOCUSABLE = 200;
/** Bond radius in Å (drawing only). */
const BOND_R = 0.12;
/** Each cell edge is drawn as this many pieces for the depth order. */
const EDGE_PIECES = 8;
/** A press that moves less than this (px) is a click on an atom, not a drag. */
const CLICK_SLOP = 5;
/** Radians turned per pixel dragged. */
const DRAG_SPEED = 0.01;

type Style = 'ball' | 'space' | 'stick';
const STYLES: [Style, string][] = [
  ['ball', 'Ball and stick'],
  ['space', 'Space filling'],
  ['stick', 'Sticks'],
];
/** Drawn atom radius in Å for a covalent radius r: a drawing choice, not a physical size. */
const atomRadius = (style: Style, r: number) =>
  style === 'space' ? r : style === 'stick' ? BOND_R * 1.4 : 0.12 + 0.38 * r;

/** The atoms drawn for one choice of polyhedra, with their bonds and polyhedron faces. */
interface Scene {
  atoms: CellAtom[];
  /** Cartesian positions (Å) about the cell centre. */
  positions: Vec3[];
  links: [number, number][];
  polyhedra: { centre: number; faces: number[][] }[];
}

type Rotation = [number, number, number, number, number, number, number, number, number];
const IDENTITY: Rotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Rotation about the screen X then Y axis by small angles (radians), applied after R. */
function turn(r: Rotation, ax: number, ay: number): Rotation {
  const [cx, sx, cy, sy] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay)];
  const q: Rotation = [cy, 0, sy, sx * sy, cx, -sx * cy, -cx * sy, sx, cx * cy];
  const out = new Array<number>(9).fill(0) as Rotation;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        out[i * 3 + j] =
          (out[i * 3 + j] as number) + (q[i * 3 + k] as number) * (r[k * 3 + j] as number);
  return out;
}

const apply = (r: Rotation, v: Vec3): Vec3 => [
  r[0] * v[0] + r[1] * v[1] + r[2] * v[2],
  r[3] * v[0] + r[4] * v[1] + r[5] * v[2],
  r[6] * v[0] + r[7] * v[1] + r[8] * v[2],
];
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rotation that looks down `dir` (it points out of the screen, as in VESTA) with `up` towards the top. */
function lookAlong(dir: Vec3, up: Vec3): Rotation {
  const z = unit(dir);
  const k = dot(up, z);
  const y = unit([up[0] - k * z[0], up[1] - k * z[1], up[2] - k * z[2]]);
  const x = cross(y, z);
  return [...x, ...y, ...z] as Rotation;
}

/** Mixes a #rrggbb colour with white (t > 0) or black (t < 0). */
function shade(hex: string, t: number): string {
  const target = t > 0 ? 255 : 0;
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(v + (target - v) * Math.abs(t));
  });
  return `rgb(${c.join(',')})`;
}

const CORNERS: Vec3[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1]);
const EDGES = CORNERS.flatMap((p, i) =>
  CORNERS.flatMap((q, j) =>
    j > i && p.reduce((n, v, k) => n + Math.abs(v - (q[k] as number)), 0) === 1 ? [[i, j]] : [],
  ),
) as [number, number][];
const START = turn(IDENTITY, -0.35, 0.5);

/** Black or white text, whichever reads better on the colour (WCAG relative luminance). */
function inkOn(hex: string): string {
  const lin = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

const fx = (x: Vec3) => x.map((v) => formatNumber(v, 4)).join(', ');

/** Unit cell of a phase drawn from its CIF structure: rotate, zoom, and measure distances and angles. */
export function StructureViewer({ phase }: { phase: ReferencePhase }) {
  const structure = phase.structure;
  const id = useId();
  const model = useMemo(() => {
    if (!structure) return null;
    const crystal = crystalFromStored(phase.cell, structure);
    const atoms = cellAtoms(crystal);
    const m = cartesianMatrix(phase.cell);
    const centre = toCartesian(m, [0.5, 0.5, 0.5]);
    const at = (x: Vec3): Vec3 => {
      const r = toCartesian(m, x);
      return [r[0] - centre[0], r[1] - centre[1], r[2] - centre[2]];
    };
    const elements = [...new Set(atoms.map((a) => a.element))].sort();
    // One scene per choice of polyhedron centre ('' for none). A polyhedron needs all of the
    // centre's bonded neighbours, so its scene adds the copies from the neighbouring cells.
    const scene = (centre: string): Scene => {
      const all = centre
        ? [...atoms, ...outsideNeighbours(phase.cell, atoms, centre, RADII)]
        : atoms;
      const where = all.map((a) => at(a.x));
      const links = bonds(phase.cell, all, RADII);
      const near = all.map(() => [] as number[]);
      for (const [i, j] of links)
        if (all[i]?.element !== all[j]?.element) {
          near[i]?.push(j);
          near[j]?.push(i);
        }
      const polyhedra = centre
        ? atoms.flatMap((a, i) => {
            const ring = near[i] ?? [];
            if (a.element !== centre || ring.length < 4) return [];
            const faces = hullFaces(ring.map((j) => where[j] as Vec3));
            return faces.length
              ? [{ centre: i, faces: faces.map((f) => f.map((k) => ring[k] as number)) }]
              : [];
          })
        : [];
      return { atoms: all, positions: where, links, polyhedra };
    };
    const scenes = new Map<string, Scene>([['', scene('')]]);
    for (const e of elements) {
      const s = scene(e);
      if (s.polyhedra.length) scenes.set(e, s);
    }
    const centres = elements.filter((e) => scenes.has(e));
    const span = Math.max(
      ...CORNERS.map(at).map((v) => Math.hypot(...v)),
      ...[...scenes.values()].flatMap((q) => q.positions.map((v) => Math.hypot(...v))),
    );
    return {
      scenes,
      centres,
      corners: CORNERS.map(at),
      /** Element of the atom sitting on each cell corner, if any (edges stop at its surface). */
      cornerAtom: CORNERS.map(
        (c) =>
          atoms.find((a) => a.x.every((v, k) => Math.abs(v - (c[k] as number)) < 1e-3))?.element,
      ),
      axes: [toCartesian(m, [1, 0, 0]), toCartesian(m, [0, 1, 0]), toCartesian(m, [0, 0, 1])],
      colour: Object.fromEntries(
        elements.map((e, i) => [e, PALETTE[i % PALETTE.length] as string]),
      ),
      elements,
      span,
    };
  }, [phase, structure]);

  const [rotation, setRotation] = useState<Rotation>(START);
  const [zoom, setZoom] = useState(1);
  const [style, setStyle] = useState<Style>('ball');
  const [labels, setLabels] = useState(true);
  const [around, setAround] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  // The press under way: where it started, the atom under it and whether it has become a drag.
  const press = useRef<{ x: number; y: number; atom: number | null; moved: boolean } | null>(null);
  // Pointer moves are added up and applied once per frame, so dragging stays smooth.
  const pending = useRef({ ax: 0, ay: 0, z: 1, frame: 0 });

  const queue = useMemo(() => {
    const flush = () => {
      const p = pending.current;
      p.frame = 0;
      const { ax, ay, z } = p;
      p.ax = 0;
      p.ay = 0;
      p.z = 1;
      if (ax || ay) setRotation((r) => turn(r, ax, ay));
      if (z !== 1) setZoom((v) => Math.min(8, Math.max(0.3, v * z)));
    };
    return (ax: number, ay: number, z = 1) => {
      const p = pending.current;
      p.ax += ax;
      p.ay += ay;
      p.z *= z;
      if (!p.frame) p.frame = requestAnimationFrame(flush);
    };
  }, []);
  useEffect(() => () => cancelAnimationFrame(pending.current.frame), []);

  // Wheel zoom needs a non-passive listener so the page does not scroll.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      queue(0, 0, Math.exp(-e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [model, queue]);

  if (!model)
    return (
      <p class="field-hint">
        No atom positions are stored for this phase (it was added in an older session). Remove it
        and add it again to see its structure.
      </p>
    );

  // Mild perspective: the camera sits a few cell sizes in front of the centre.
  const camera = model.span * 4;
  const scale = ((VIEW / 2 - 12) / (model.span + 0.6)) * zoom * 0.9;
  const project = (v: Vec3) => {
    const p = apply(rotation, v);
    const f = camera / (camera - p[2]);
    return { x: VIEW / 2 + p[0] * scale * f, y: VIEW / 2 - p[1] * scale * f, z: p[2], f };
  };
  const scene = model.scenes.get(around) ?? (model.scenes.get('') as Scene);
  const shown = scene.positions.map(project);
  const atoms = scene.atoms;
  // With polyhedra shown, their centre atoms are drawn smaller so the polyhedra stay readable.
  const rOf = (i: number) => {
    const el = atoms[i]?.element ?? '';
    return atomRadius(style, RADII[el] ?? 1) * (el === around && style !== 'stick' ? 0.55 : 1);
  };

  // Painter's order: atoms and half-bonds sorted back to front by depth.
  type Item = { z: number; node: preact.JSX.Element };
  const items: Item[] = [];
  if (style !== 'space')
    scene.links.forEach(([i, j]) => {
      const [a, b] = [scene.positions[i] as Vec3, scene.positions[j] as Vec3];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
      const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const pm = project(mid);
      for (const [from, to, k] of [
        [a, b, i],
        [b, a, j],
      ] as [Vec3, Vec3, number][]) {
        const t = (rOf(k) * 0.8) / d;
        const start = project([
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
          from[2] + (to[2] - from[2]) * t,
        ]);
        const el = atoms[k]?.element ?? '';
        const w = 2 * BOND_R * scale * pm.f;
        items.push({
          z: (start.z + pm.z) / 2,
          node: (
            <g key={`b${i}-${j}-${k}`} class="structure-bond">
              <line
                x1={start.x}
                y1={start.y}
                x2={pm.x}
                y2={pm.y}
                stroke={shade(model.colour[el] ?? '#999999', -0.45)}
                stroke-width={w + 1.2}
              />
              <line
                x1={start.x}
                y1={start.y}
                x2={pm.x}
                y2={pm.y}
                stroke={model.colour[el]}
                stroke-width={w}
              />
            </g>
          ),
        });
      }
    });

  const pick = (i: number) =>
    setPicked((p) => (p.includes(i) ? p.filter((j) => j !== i) : [...p, i].slice(-3)));
  const name = (i: number) => {
    const a = atoms[i];
    return a ? `${a.label} (${fx(a.x)})` : '';
  };
  const focusable = atoms.length <= MAX_FOCUSABLE;

  // Polyhedron faces join the depth order one by one, so atoms in front of a face cover it.
  scene.polyhedra.forEach(({ centre, faces }) => {
    const el = atoms[centre]?.element ?? '';
    const c = model.colour[el] ?? '#999999';
    faces.forEach((f, n) => {
      const pts = f.map((j) => shown[j] as { x: number; y: number; z: number });
      items.push({
        z: pts.reduce((sum, q) => sum + q.z, 0) / pts.length,
        node: (
          <polygon
            key={`p${centre}-${n}`}
            class="structure-face"
            points={pts.map((q) => `${q.x},${q.y}`).join(' ')}
            fill={c}
            stroke={shade(c, -0.5)}
          />
        ),
      });
    });
  });

  shown.forEach((p, i) => {
    const a = atoms[i];
    if (!a) return;
    const chosen = picked.indexOf(i);
    const r = Math.max(2, rOf(i) * scale * p.f);
    items.push({
      z: p.z,
      node: (
        <g key={`a${i}`}>
          <circle
            class={chosen >= 0 ? 'structure-atom is-picked' : 'structure-atom'}
            cx={p.x}
            cy={p.y}
            r={r}
            fill={`url(#${id}-${a.element})`}
            stroke={chosen >= 0 ? undefined : shade(model.colour[a.element] ?? '#999999', -0.55)}
            data-atom={i}
            tabIndex={focusable ? 0 : undefined}
            role={focusable ? 'button' : undefined}
            aria-pressed={focusable ? chosen >= 0 : undefined}
            aria-label={focusable ? name(i) : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick(i);
              }
            }}
          >
            <title>{name(i)}</title>
          </circle>
          {labels && style !== 'stick' && r >= 7 && (
            <text
              class="structure-symbol"
              x={p.x}
              y={p.y}
              fill={inkOn(model.colour[a.element] ?? '#999999')}
              font-size={Math.min(16, r * 0.9)}
            >
              {a.element}
            </text>
          )}
          {chosen >= 0 && (
            <text class="structure-label" x={p.x} y={p.y - r - 3} text-anchor="middle">
              {`${chosen + 1}: ${a.label}`}
            </text>
          )}
        </g>
      ),
    });
  });
  // Cell edges join the depth order in short pieces, so atoms in front cover them.
  EDGES.forEach(([i, j]) => {
    const [u, v] = [model.corners[i] as Vec3, model.corners[j] as Vec3];
    const len = Math.hypot(v[0] - u[0], v[1] - u[1], v[2] - u[2]) || 1;
    const trim = (el: string | undefined) => (el ? atomRadius(style, RADII[el] ?? 1) / len : 0);
    const [t0, t1] = [trim(model.cornerAtom[i]), 1 - trim(model.cornerAtom[j])];
    if (t1 <= t0) return;
    const at = (t: number) =>
      project([u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t, u[2] + (v[2] - u[2]) * t]);
    for (let n = 0; n < EDGE_PIECES; n++) {
      const [p, q] = [
        at(t0 + ((t1 - t0) * n) / EDGE_PIECES),
        at(t0 + ((t1 - t0) * (n + 1)) / EDGE_PIECES),
      ];
      items.push({
        z: (p.z + q.z) / 2,
        node: (
          <line
            key={`e${i}-${j}-${n}`}
            class="structure-cell"
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
          />
        ),
      });
    }
  });
  items.sort((a, b) => a.z - b.z);

  const view = (k: 0 | 1 | 2) => {
    const up = model.axes[k === 2 ? 1 : 2] as Vec3;
    setRotation(lookAlong(model.axes[k] as Vec3, up));
    setZoom(1);
  };

  const onKey = (e: KeyboardEvent) => {
    const step = Math.PI / 18;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => setRotation((r) => turn(r, 0, -step)),
      ArrowRight: () => setRotation((r) => turn(r, 0, step)),
      ArrowUp: () => setRotation((r) => turn(r, -step, 0)),
      ArrowDown: () => setRotation((r) => turn(r, step, 0)),
      '+': () => setZoom((z) => Math.min(8, z * 1.2)),
      '=': () => setZoom((z) => Math.min(8, z * 1.2)),
      '-': () => setZoom((z) => Math.max(0.3, z / 1.2)),
      '0': () => {
        setRotation(START);
        setZoom(1);
      },
    };
    const move = moves[e.key];
    if (move && e.target === e.currentTarget) {
      e.preventDefault();
      move();
    }
  };

  // One handler for the whole drawing: a press that moves is a rotation (or, with two fingers,
  // a pinch zoom) wherever it starts, including on an atom; a press that stays put picks the
  // atom under it.
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const hit = (e.target as Element).closest?.('[data-atom]')?.getAttribute('data-atom');
    press.current =
      pointers.current.size === 1
        ? { x: e.clientX, y: e.clientY, atom: hit ? Number(hit) : null, moved: false }
        : null;
  };
  const onPointerMove = (e: PointerEvent) => {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [
        { x: number; y: number },
        { x: number; y: number },
      ];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current !== null) queue(0, 0, d / pinch.current);
      pinch.current = d;
      return;
    }
    const p = press.current;
    if (p && !p.moved) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < CLICK_SLOP) return;
      p.moved = true;
      queue((e.clientY - p.y) * DRAG_SPEED, (e.clientX - p.x) * DRAG_SPEED);
      return;
    }
    queue((e.clientY - last.y) * DRAG_SPEED, (e.clientX - last.x) * DRAG_SPEED);
  };
  const onPointerUp = (e: PointerEvent) => {
    const p = press.current;
    if (e.type === 'pointerup' && p && !p.moved && p.atom !== null) pick(p.atom);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) press.current = null;
  };

  // Axis triad in the lower left corner.
  const triad = model.axes.map((v, k) => {
    const p = apply(rotation, unit(v));
    return { k, x: 34 + p[0] * 22, y: VIEW - 34 - p[1] * 22, z: p[2] };
  });

  const xs = picked.map((i) => atoms[i]?.x as Vec3);

  return (
    <div class="structure-viewer">
      <div class="structure-tools">
        <label>
          Style{' '}
          <select
            value={style}
            onChange={(e) => setStyle((e.currentTarget as HTMLSelectElement).value as Style)}
          >
            {STYLES.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <span class="structure-views" role="group" aria-label="View along a cell axis">
          <span class="structure-views-label" aria-hidden="true">
            View along
          </span>
          {(['a', 'b', 'c'] as const).map((axis, k) => (
            <button
              key={axis}
              type="button"
              class="btn"
              aria-label={`View along ${axis}`}
              onClick={() => view(k as 0 | 1 | 2)}
            >
              <em>{axis}</em>
            </button>
          ))}
          <button
            type="button"
            class="btn"
            onClick={() => {
              setRotation(START);
              setZoom(1);
            }}
          >
            Reset
          </button>
        </span>
        <label class="check">
          <input
            type="checkbox"
            checked={labels}
            onChange={(e) => setLabels((e.currentTarget as HTMLInputElement).checked)}
          />
          Element symbols
        </label>
        {model.centres.length > 0 && (
          <label>
            Polyhedra{' '}
            <select
              value={around}
              onChange={(e) => {
                setAround((e.currentTarget as HTMLSelectElement).value);
                setPicked([]);
              }}
            >
              <option value="">None</option>
              {model.centres.map((el) => (
                <option key={el} value={el}>
                  Around {el}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <svg
        ref={svg}
        class="structure-canvas"
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role="application"
        aria-label={`Unit cell of ${phase.name}. Arrow keys rotate, plus and minus zoom, 0 resets.`}
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          {model.elements.map((el) => {
            const c = model.colour[el] ?? '#999999';
            return (
              // A light from the upper left: a bright spot, the colour, then a darker rim.
              <radialGradient
                key={el}
                id={`${id}-${el}`}
                cx="0.45"
                cy="0.42"
                r="0.62"
                fx="0.32"
                fy="0.28"
              >
                <stop offset="0" stop-color={shade(c, 0.85)} />
                <stop offset="0.22" stop-color={shade(c, 0.3)} />
                <stop offset="0.62" stop-color={c} />
                <stop offset="1" stop-color={shade(c, -0.45)} />
              </radialGradient>
            );
          })}
        </defs>
        {items.map((it) => it.node)}
        <g class="structure-triad" aria-hidden="true">
          {[...triad]
            .sort((a, b) => a.z - b.z)
            .map((t) => (
              <g key={t.k}>
                <line x1={34} y1={VIEW - 34} x2={t.x} y2={t.y} />
                <text x={34 + (t.x - 34) * 1.35} y={VIEW - 34 + (t.y - VIEW + 34) * 1.35 + 4}>
                  {'abc'[t.k]}
                </text>
              </g>
            ))}
        </g>
      </svg>
      <ul class="structure-legend" aria-label="Element colours">
        {model.elements.map((el) => (
          <li key={el}>
            <span
              class="structure-swatch"
              style={{ background: model.colour[el] }}
              aria-hidden="true"
            />
            {el}
          </li>
        ))}
      </ul>
      <div class="structure-measure" aria-live="polite">
        {picked.length === 0 && (
          <p class="field-hint">
            Drag anywhere to rotate, scroll or pinch to zoom. Click (tap) two atoms for a distance,
            three for an angle.
          </p>
        )}
        {picked.length >= 1 && <p>Picked: {picked.map(name).join(' → ')}</p>}
        {picked.length >= 2 && (
          <p>
            Distance {atoms[picked[0] as number]?.label}–{atoms[picked[1] as number]?.label}:{' '}
            <strong>{formatNumber(distance(phase.cell, xs[0] as Vec3, xs[1] as Vec3), 4)} Å</strong>
          </p>
        )}
        {picked.length === 3 && (
          <p>
            Distance {atoms[picked[1] as number]?.label}–{atoms[picked[2] as number]?.label}:{' '}
            <strong>{formatNumber(distance(phase.cell, xs[1] as Vec3, xs[2] as Vec3), 4)} Å</strong>
            {' · '}Angle at {atoms[picked[1] as number]?.label}:{' '}
            <strong>
              {formatNumber(angle(phase.cell, xs[0] as Vec3, xs[1] as Vec3, xs[2] as Vec3), 2)}°
            </strong>
          </p>
        )}
        {picked.length > 0 && (
          <button type="button" class="btn btn-quiet" onClick={() => setPicked([])}>
            Clear selection
          </button>
        )}
      </div>
      <p class="field-hint">
        {atoms.length} atoms drawn: the cell's own atoms plus copies on its faces, edges and corners
        {around ? `, and the neighbours outside the cell that the ${around} polyhedra need` : ''}.
        Bonds join atoms in this drawing closer than the sum of their covalent radii plus{' '}
        {BOND_TOLERANCE} Å.{' '}
        <HelpTip term="how the structure is drawn">
          <p>
            Atom positions come from the CIF: each listed atom is moved by every symmetry operator
            of the space group. Distances and angles use the cell's metric tensor, so they hold for
            any crystal system. Covalent radii are from Cordero et al., Dalton Trans. 2008, 2832.
            Drawn sizes are scaled from them for clarity (full covalent radius in space filling). A
            bond here is a drawing aid, not a claim about the chemistry. Partly occupied sites are
            drawn as full atoms. A polyhedron joins the neighbours bonded to one atom in this
            drawing; it is drawn only where the drawing holds all of them.
          </p>
        </HelpTip>
      </p>
    </div>
  );
}
