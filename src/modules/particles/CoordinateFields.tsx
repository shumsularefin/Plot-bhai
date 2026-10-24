import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Point } from '../../core/particles/geometry';

interface CoordinateFieldsProps {
  /** Text for the button that applies the two points. */
  action: string;
  /** Largest x and y (the image size), to catch typing mistakes. */
  width: number;
  height: number;
  onApply: (a: Point, b: Point) => void;
  /** Extra controls placed before the numbers, for example a choice of shape. */
  children?: ComponentChildren;
}

/**
 * A keyboard alternative to drawing: type the pixel coordinates of two points of the original
 * image (x to the right, y down, from the top left corner).
 */
export function CoordinateFields({
  action,
  width,
  height,
  onApply,
  children,
}: CoordinateFieldsProps) {
  const [values, setValues] = useState({ x1: '', y1: '', x2: '', y2: '' });
  const numbers = Object.values(values).map((v) => (v.trim() === '' ? NaN : Number(v)));
  const [x1, y1, x2, y2] = numbers as [number, number, number, number];
  const inside = (x: number, y: number) => x >= 0 && x <= width && y >= 0 && y <= height;
  const valid = numbers.every(Number.isFinite) && inside(x1, y1) && inside(x2, y2);
  const field = (key: keyof typeof values, label: string) => (
    <label class="inline-field">
      {label}
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={values[key]}
        onInput={(e) => setValues({ ...values, [key]: e.currentTarget.value })}
      />
    </label>
  );
  return (
    <details class="paste-box">
      <summary>Enter coordinates instead of drawing</summary>
      <div class="radiation-fields">
        {children}
        {field('x1', 'First point x (px)')}
        {field('y1', 'First point y (px)')}
        {field('x2', 'Second point x (px)')}
        {field('y2', 'Second point y (px)')}
        <button
          type="button"
          class="btn"
          disabled={!valid}
          onClick={() => onApply({ x: x1, y: y1 }, { x: x2, y: y2 })}
        >
          {action}
        </button>
      </div>
      <p class="field-hint">
        Pixels of the original image, counted from its top left corner (0 to {width} across, 0 to{' '}
        {height} down).
      </p>
    </details>
  );
}
