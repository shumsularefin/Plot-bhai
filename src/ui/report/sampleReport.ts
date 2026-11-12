/*
 * The sample report: what the XRD, FTIR, UV-Vis and thermal tools found for one sample, put
 * together in one document with a single methods section. Nothing is calculated here; each
 * part carries the result lines and the methods paragraph that its own tool wrote.
 */

import { SOFTWARE } from '../software';

/** One technique's contribution to the report. */
export interface ReportPart {
  /** Name of the technique, for example "XRD". */
  tool: string;
  /** The data sets the results come from, by name. */
  data: string[];
  /** True when any of the data is generated example data, not a measurement. */
  example: boolean;
  /** Results in sections, as the tool's own record lists them. */
  results: { title: string; lines: string[] }[];
  /** The tool's methods paragraph, written from the settings used. */
  methods: string;
}

/** The methods paragraphs of every part, one paragraph per technique, in the order given. */
export function combinedMethods(parts: readonly ReportPart[]): string {
  return parts.map((p) => p.methods.trim()).join('\n\n');
}

const bullet = (text: string) => `- ${text.replace(/\n+/g, ' ')}`;

/** The report as Markdown. `created` is an ISO date-time. */
export function sampleReportMarkdown(
  sample: string,
  parts: readonly ReportPart[],
  created: string,
): string {
  const lines = [
    `# Sample report: ${sample.trim() || 'unnamed sample'}`,
    '',
    `Created ${created} with ${SOFTWARE}.`,
    `Techniques: ${parts.map((p) => p.tool).join(', ') || 'none'}.`,
    'Every value below is an estimate from a model; the method and its settings are in the methods section. All processing ran in the browser; nothing was uploaded.',
    '',
  ];
  if (parts.some((p) => p.example)) {
    lines.push(
      `Warning: ${parts
        .filter((p) => p.example)
        .map((p) => p.tool)
        .join(', ')} used generated example data, not measurements. Do not report those results.`,
      '',
    );
  }
  for (const part of parts) {
    lines.push(`## ${part.tool}`, '', `Data: ${part.data.join('; ') || 'none'}.`, '');
    for (const section of part.results) {
      lines.push(`### ${section.title}`, '', ...section.lines.map(bullet), '');
    }
    if (part.results.length === 0) lines.push('No results yet.', '');
  }
  lines.push('## Methods', '', combinedMethods(parts), '');
  return `${lines.join('\n')}\n`;
}
