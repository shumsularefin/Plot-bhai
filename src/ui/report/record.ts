/*
 * The analysis record: a plain-text (Markdown) account of one analysis that lets someone else
 * repeat it. It names each data set with a fingerprint of its numbers, lists the settings read
 * from the file, the processing steps in the order they ran with every parameter, what the
 * analysis found with its fit statistics, every warning shown, and the methods text. It is
 * written from the saved session, so it always matches what the tool used.
 */

import type { DataMessage } from '../../core/xrd/types';
import { SOFTWARE } from '../software';

export interface RecordStep {
  name: string;
  /** False for steps that are available but were switched off. */
  used: boolean;
  /** Parameter descriptions, for example "window 11 points". */
  parameters: string[];
  messages: readonly DataMessage[];
}

export interface RecordData {
  name: string;
  /** Format, size and range, for example "csv, 3500 points, 10.01 to 79.99° 2θ". */
  description: string;
  /** SHA-256 of the numbers as loaded (see fingerprint). */
  fingerprint: string;
  /** Settings listed in the file itself, as written. */
  fromFile: readonly { key: string; value: string }[];
  /** Notes from reading the file. */
  notes: readonly DataMessage[];
  /** Processing in the order it ran. */
  steps: RecordStep[];
}

export interface AnalysisRecord {
  tool: string;
  data: RecordData[];
  /** Settings that apply to every data set (radiation, display quantity and the like). */
  shared: string[];
  /** Results with their statistics, in sections. */
  results: { title: string; lines: string[] }[];
  methods: string;
}

/**
 * SHA-256 (hex) of the numbers, as little-endian 64-bit floats one array after another. The
 * same file loaded again gives the same fingerprint; any change to a value gives another one.
 */
export async function fingerprint(arrays: readonly Float64Array[]): Promise<string> {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const bytes = new Uint8Array(total * 8);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (const a of arrays) for (const v of a) view.setFloat64(at++ * 8, v, true);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const bullet = (text: string) => `- ${text.replace(/\n+/g, ' ')}`;
const level = (m: DataMessage) =>
  m.level === 'info' ? 'Note' : m.level === 'warning' ? 'Warning' : 'Error';

/** The record as Markdown. `created` is an ISO date-time. */
export function recordMarkdown(record: AnalysisRecord, created: string): string {
  const lines: string[] = [
    `# ${record.tool} analysis record`,
    '',
    `Created ${created} with ${SOFTWARE}.`,
    'All processing ran in the browser; nothing was uploaded.',
    '',
  ];
  if (record.shared.length > 0) {
    lines.push('## Settings for all data', '', ...record.shared.map(bullet), '');
  }
  const warnings: string[] = [];
  for (const d of record.data) {
    lines.push(
      `## Data: ${d.name}`,
      '',
      bullet(d.description),
      bullet(`SHA-256 of the values as loaded: ${d.fingerprint}`),
    );
    if (d.fromFile.length > 0) {
      lines.push(
        '',
        'Settings stated in the file:',
        '',
        ...d.fromFile.map((f) => bullet(`${f.key}: ${f.value}`)),
      );
    }
    for (const n of d.notes) {
      lines.push(bullet(`${level(n)} on reading: ${n.text}`));
      if (n.level !== 'info') warnings.push(`${d.name}: ${n.text}`);
    }
    lines.push('', 'Processing, in the order it ran:', '');
    d.steps.forEach((s, i) => {
      lines.push(
        `${i + 1}. ${s.name}: ${s.used ? (s.parameters.length ? s.parameters.join(', ') : 'on') : 'not used'}`,
      );
      for (const m of s.messages) {
        lines.push(`   - ${level(m)}: ${m.text}`);
        if (m.level !== 'info') warnings.push(`${d.name}, ${s.name}: ${m.text}`);
      }
    });
    lines.push('');
  }
  for (const section of record.results) {
    lines.push(`## ${section.title}`, '', ...section.lines.map(bullet), '');
  }
  lines.push(
    '## Warnings shown',
    '',
    ...(warnings.length ? warnings.map(bullet) : ['- None.']),
    '',
  );
  lines.push('## Methods text', '', record.methods, '');
  return `${lines.join('\n')}\n`;
}
