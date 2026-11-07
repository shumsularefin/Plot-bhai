import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import {
  angle,
  BOND_TOLERANCE,
  bonds,
  cartesianMatrix,
  cellAtoms,
  crystalFromStored,
  distance,
  toCartesian,
  type Vec3,
} from '../../core/xrd/structure/geometry';
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

type Style = 'ball' | 'space' | 'stick';
const STYLES: [Style, string][] = [
  ['ball', 'Ball and stick'],
  ['space', 'Space filling'],
  ['stick', 'Sticks'],
];
/** Drawn atom radius in Å for a covalent radius r: a drawing choice, not a physical size. */
const atomRadius = (style: Style, r: number) =>
  style === 'space' ? r : style === 'stick' ? BOND_R * 1.4 : 0.1 + 0.38 * r;

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
    const span = Math.max(...CORNERS.map((c) => Math.hypot(...at(c))));
    return {
      atoms,
      positions: atoms.map((a) => at(a.x)),
      corners: CORNERS.map(at),
      /** Element of the atom sitting on each cell corner, if any (edges stop at its surface). */
      cornerAtom: CORNERS.map(
        (c) =>
          atoms.find((a) => a.x.every((v, k) => Math.abs(v - (c[k] as number)) < 1e-3))?.element,
      ),
      axes: [toCartesian(m, [1, 0, 0]), toCartesian(m, [0, 1, 0]), toCartesian(m, [0, 0, 1])],
      links: bonds(phase.cell, atoms, RADII),
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
  const [labels, setLabels] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
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
  const scale = ((VIEW / 2 - 16) / model.span) * zoom * 0.88;
  const project = (v: Vec3) => {
    const p = apply(rotation, v);
    const f = camera / (camera - p[2]);
    return { x: VIEW / 2 + p[0] * scale * f, y: VIEW / 2 - p[1] * scale * f, z: p[2], f };
  };
  const shown = model.positions.map(project);
  const atoms = model.atoms;
  const rOf = (i: number) => atomRadius(style, RADII[atoms[i]?.element ?? ''] ?? 1);

  // Painter's order: atoms and half-bonds sorted back to front by depth.
  type Item = { z: number; node: preact.JSX.Element };
  const items: Item[] = [];
  if (style !== 'space')
    model.links.forEach(([i, j]) => {
      const [a, b] = [model.positions[i] as Vec3, model.positions[j] as Vec3];
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
            tabIndex={focusable ? 0 : undefined}
            role={focusable ? 'button' : undefined}
            aria-pressed={focusable ? chosen >= 0 : undefined}
            aria-label={focusable ? name(i) : undefined}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => pick(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                pick(i);
              }
            }}
          >
            <title>{name(i)}</title>
          </circle>
          {(labels || chosen >= 0) && (
            <text class="structure-label" x={p.x} y={p.y - r - 3} text-anchor="middle">
              {chosen >= 0 ? `${chosen + 1}: ${a.label}` : a.label}
            </text>
          )}
        </g>
      ),
    });
  });
  // Cell edges join the depth order in short pieces, so atoms in front cover them; the
  // pieces behind the centre are dashed.
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
            class={p.z + q.z < 0 ? 'structure-cell is-back' : 'structure-cell'}
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

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
    queue((e.clientY - last.y) * 0.01, (e.clientX - last.x) * 0.01);
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
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
          {(['a', 'b', 'c'] as const).map((axis, k) => (
            <button
              key={axis}
              type="button"
              class="btn btn-quiet"
              aria-label={`View along ${axis}`}
              onClick={() => view(k as 0 | 1 | 2)}
            >
              <em>{axis}</em>
            </button>
          ))}
          <button
            type="button"
            class="btn btn-quiet"
            onClick={() => {
              setRotation(START);
              setZoom(1);
            }}
          >
            Reset
          </button>
        </span>
        <label class="structure-check">
          <input
            type="checkbox"
            checked={labels}
            onChange={(e) => setLabels((e.currentTarget as HTMLInputElement).checked)}
          />{' '}
          Labels
        </label>
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
              <radialGradient key={el} id={`${id}-${el}`} cx="0.35" cy="0.3" r="0.75">
                <stop offset="0" stop-color={shade(c, 0.75)} />
                <stop offset="0.35" stop-color={c} />
                <stop offset="1" stop-color={shade(c, -0.5)} />
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
            Drag to rotate, scroll or pinch to zoom. Click two atoms for a distance, three for an
            angle.
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
        {atoms.length} atoms drawn: the cell's own atoms plus copies on its faces, edges and
        corners. Bonds join atoms in this drawing closer than the sum of their covalent radii plus{' '}
        {BOND_TOLERANCE} Å.{' '}
        <HelpTip term="how the structure is drawn">
          <p>
            Atom positions come from the CIF: each listed atom is moved by every symmetry operator
            of the space group. Distances and angles use the cell's metric tensor, so they hold for
            any crystal system. Covalent radii are from Cordero et al., Dalton Trans. 2008, 2832.
            Drawn sizes are scaled from them for clarity (full covalent radius in space filling). A
            bond here is a drawing aid, not a claim about the chemistry. Partly occupied sites are
            drawn as full atoms.
          </p>
        </HelpTip>
      </p>
    </div>
  );
}
