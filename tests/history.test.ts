import { describe, expect, it } from 'vitest';
import {
  editsText,
  emptyHistory,
  HISTORY_LIMIT,
  historyKey,
  MERGE_MS,
  record,
  redo,
  undo,
} from '../src/ui/wizard/history';

describe('undo history', () => {
  /** The result of an undo or redo, which these tests expect to exist. */
  const sure = <T>(value: T | null): T => {
    if (value === null) throw new Error('expected a step');
    return value;
  };

  it('undoes and redoes changes in order', () => {
    let h = emptyHistory<string>();
    h = record(h, 'a', 0);
    h = record(h, 'b', 10_000);
    const back = sure(undo(h, 'c'));
    expect(back.data).toBe('b');
    const back2 = sure(undo(back.history, 'b'));
    expect(back2.data).toBe('a');
    expect(undo(back2.history, 'a')).toBeNull();
    const forward = sure(redo(back2.history, 'a'));
    expect(forward.data).toBe('b');
    expect(redo(forward.history, 'b')?.data).toBe('c');
  });

  it('merges quick changes into one step and clears redo on a new change', () => {
    let h = emptyHistory<number>();
    h = record(h, 0, 0);
    h = record(h, 1, MERGE_MS / 2);
    h = record(h, 2, MERGE_MS);
    expect(h.past).toEqual([0]);
    const back = sure(undo(h, 3));
    expect(back.data).toBe(0);
    expect(record(back.history, 0, 50_000).future).toEqual([]);
  });

  it('keeps at most the limit', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = record(h, i, i * 10_000);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(20);
  });

  it('reads the shortcuts', () => {
    const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey', boolean>>) =>
      historyKey({
        key: k,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        ...mods,
      });
    expect(key('z', { ctrlKey: true })).toBe('undo');
    expect(key('Z', { metaKey: true, shiftKey: true })).toBe('redo');
    expect(key('y', { ctrlKey: true })).toBe('redo');
    expect(key('z', {})).toBeNull();
  });

  it('leaves text boxes their own undo', () => {
    const text = document.createElement('input');
    const box = document.createElement('input');
    box.type = 'checkbox';
    expect(editsText(text)).toBe(true);
    expect(editsText(document.createElement('textarea'))).toBe(true);
    expect(editsText(box)).toBe(false);
    expect(editsText(document.createElement('button'))).toBe(false);
  });
});
