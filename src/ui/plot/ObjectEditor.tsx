import { useEffect, useRef } from 'preact/hooks';
import {
  ANNOTATION_LABELS,
  labelKey,
  movedAnnotation,
  type EditRef,
  type FigureStyle,
} from './figure';
import type { ObjectMove } from './InteractivePlot';
import type { PeakLabelSet } from './peakLabels';

/**
 * The figure with one object moved by a drag: a peak label gets an offset (fractions of the plot
 * area), an annotation moves in data units. `reversed` is true when the x axis shows −x.
 */
export function moveObject(
  figure: FigureStyle,
  ref: EditRef,
  move: ObjectMove,
  reversed: boolean,
): FigureStyle {
  if (ref.startsWith('label:')) {
    const key = ref.slice(6);
    const before = figure.peakLabels.offset?.[key] ?? { dx: 0, dy: 0 };
    return {
      ...figure,
      peakLabels: {
        ...figure.peakLabels,
        offset: {
          ...figure.peakLabels.offset,
          [key]: { dx: before.dx + move.dxFraction, dy: before.dy + move.dyFraction },
        },
      },
    };
  }
  const id = ref.slice(11);
  return {
    ...figure,
    annotations: figure.annotations.map((a) =>
      a.id === id ? movedAnnotation(a, reversed ? -move.dx : move.dx, move.dy) : a,
    ),
  };
}

interface ObjectEditorProps {
  selected: EditRef;
  figure: FigureStyle;
  onChange: (next: FigureStyle) => void;
  peakLabels: PeakLabelSet | undefined;
  onClose: () => void;
}

/**
 * A small bar under the plot for the object picked on it: edit its text, colour or size, put a
 * moved label back, or remove it. Drag the object on the plot to move it.
 */
export function ObjectEditor({
  selected,
  figure,
  onChange,
  peakLabels,
  onClose,
}: ObjectEditorProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), [selected]);

  if (selected.startsWith('label:')) {
    const key = selected.slice(6);
    const label = peakLabels?.labels.find((l) => labelKey(l) === key);
    if (!label) return null;
    const moved = figure.peakLabels.offset?.[key] !== undefined;
    const setText = (text: string) =>
      onChange({
        ...figure,
        peakLabels: { ...figure.peakLabels, text: { ...figure.peakLabels.text, [key]: text } },
      });
    const resetPosition = () => {
      const offset = Object.fromEntries(
        Object.entries(figure.peakLabels.offset ?? {}).filter(([k]) => k !== key),
      );
      onChange({ ...figure, peakLabels: { ...figure.peakLabels, offset } });
    };
    return (
      <div class="object-editor" role="group" aria-label="Selected peak label">
        <label class="object-editor-text">
          Label
          <input
            ref={input}
            value={figure.peakLabels.text[key] ?? label.text}
            onInput={(e) => setText(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && onClose()}
          />
        </label>
        {moved && (
          <button type="button" class="btn btn-quiet" onClick={resetPosition}>
            Put back
          </button>
        )}
        <button
          type="button"
          class="btn btn-quiet"
          onClick={() => {
            setText('');
            onClose();
          }}
        >
          Hide
        </button>
        <button type="button" class="btn" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  const id = selected.slice(11);
  const a = figure.annotations.find((x) => x.id === id);
  if (!a) return null;
  const set = (patch: Partial<typeof a>) =>
    onChange({
      ...figure,
      annotations: figure.annotations.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    });
  const remove = () => {
    onChange({ ...figure, annotations: figure.annotations.filter((x) => x.id !== id) });
    onClose();
  };
  return (
    <div class="object-editor" role="group" aria-label={`Selected ${ANNOTATION_LABELS[a.kind]}`}>
      <label class="object-editor-text">
        {a.kind === 'text' ? 'Text' : `${ANNOTATION_LABELS[a.kind]} label`}
        <input
          ref={input}
          value={a.text}
          onInput={(e) => set({ text: e.currentTarget.value })}
          onKeyDown={(e) => e.key === 'Enter' && onClose()}
        />
      </label>
      <label class="object-editor-color">
        <span class="visually-hidden">Colour</span>
        <input
          type="color"
          value={a.color || '#000000'}
          onInput={(e) => set({ color: e.currentTarget.value })}
        />
      </label>
      <button
        type="button"
        class="btn btn-quiet"
        aria-label="Smaller"
        onClick={() => set({ size: Math.max(0.5, Number((a.size - 0.1).toFixed(2))) })}
      >
        A−
      </button>
      <button
        type="button"
        class="btn btn-quiet"
        aria-label="Larger"
        onClick={() => set({ size: Math.min(4, Number((a.size + 0.1).toFixed(2))) })}
      >
        A+
      </button>
      <button type="button" class="btn btn-quiet" onClick={remove}>
        Delete
      </button>
      <button type="button" class="btn" onClick={onClose}>
        Done
      </button>
    </div>
  );
}
