import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
const VIEW = 320;
/** Atoms beyond this are not focusable one by one, to keep keyboard use practical. */
const MAX_FOCUSABLE = 200;

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

const CORNERS: Vec3[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1]);
const EDGES = CORNERS.flatMap((p, i) =>
  CORNERS.flatMap((q, j) =>
    j > i && p.reduce((n, v, k) => n + Math.abs(v - (q[k] as number)), 0) === 1 ? [[i, j]] : [],
  ),
) as [number, number][];

const fx = (x: Vec3) => x.map((v) => formatNumber(v, 4)).join(', ');

/** Unit cell of a phase drawn from its CIF structure: rotate, zoom, and measure distances and angles. */
export function StructureViewer({ phase }: { phase: ReferencePhase }) {
  const structure = phase.structure;
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
      links: bonds(phase.cell, atoms, RADII),
      colour: Object.fromEntries(
        elements.map((e, i) => [e, PALETTE[i % PALETTE.length] as string]),
      ),
      elements,
      span,
    };
  }, [phase, structure]);

  const [rotation, setRotation] = useState<Rotation>(() => turn(IDENTITY, -0.35, 0.5));
  const [zoom, setZoom] = useState(1);
  const [picked, setPicked] = useState<number[]>([]);
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  // Wheel zoom needs a non-passive listener so the page does not scroll.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(8, Math.max(0.3, z * Math.exp(-e.deltaY * 0.0015))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [model]);

  if (!model)
    return (
      <p class="field-hint">
        No atom positions are stored for this phase (it was added in an older session). Remove it
        and add it again to see its structure.
      </p>
    );

  const scale = ((VIEW / 2 - 12) / model.span) * zoom;
  const project = (v: Vec3) => {
    const p = apply(rotation, v);
    return { x: VIEW / 2 + p[0] * scale, y: VIEW / 2 - p[1] * scale, z: p[2] };
  };
  const shown = model.positions.map(project);
  const corners = model.corners.map(project);
  const order = shown.map((_, i) => i).sort((a, b) => (shown[a]?.z ?? 0) - (shown[b]?.z ?? 0));
  const radius = (el: string) => Math.max(3, (0.18 + 0.22 * (RADII[el] ?? 1)) * scale);

  const pick = (i: number) =>
    setPicked((p) => (p.includes(i) ? p.filter((j) => j !== i) : [...p, i].slice(-3)));

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
        setRotation(turn(IDENTITY, -0.35, 0.5));
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
      if (pinch.current !== null) {
        const ratio = d / pinch.current;
        setZoom((z) => Math.min(8, Math.max(0.3, z * ratio)));
      }
      pinch.current = d;
      return;
    }
    setRotation((r) => turn(r, (e.clientY - last.y) * 0.01, (e.clientX - last.x) * 0.01));
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinch.current = null;
  };

  const atoms = model.atoms;
  const name = (i: number) => {
    const a = atoms[i];
    return a ? `${a.label} (${fx(a.x)})` : '';
  };
  const xs = picked.map((i) => atoms[i]?.x as Vec3);
  const focusable = atoms.length <= MAX_FOCUSABLE;

  return (
    <div class="structure-viewer">
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
        {EDGES.map(([i, j]) => (
          <line
            key={`e${i}-${j}`}
            class="structure-cell"
            x1={corners[i]?.x}
            y1={corners[i]?.y}
            x2={corners[j]?.x}
            y2={corners[j]?.y}
          />
        ))}
        {model.links.map(([i, j]) => (
          <line
            key={`b${i}-${j}`}
            class="structure-bond"
            x1={shown[i]?.x}
            y1={shown[i]?.y}
            x2={shown[j]?.x}
            y2={shown[j]?.y}
          />
        ))}
        {order.map((i) => {
          const a = atoms[i];
          const p = shown[i];
          if (!a || !p) return null;
          const chosen = picked.indexOf(i);
          return (
            <circle
              key={i}
              class={chosen >= 0 ? 'structure-atom is-picked' : 'structure-atom'}
              cx={p.x}
              cy={p.y}
              r={radius(a.element)}
              fill={model.colour[a.element]}
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
          );
        })}
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
          <p class="field-hint">Click two atoms for a distance, three for an angle.</p>
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
            any crystal system. Covalent radii are from Cordero et al., Dalton Trans. 2008, 2832. A
            bond here is a drawing aid, not a claim about the chemistry. Partly occupied sites are
            drawn as full atoms.
          </p>
        </HelpTip>
      </p>
    </div>
  );
}
