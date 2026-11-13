import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatWithSigma } from '../../ui/format';
import { useStore } from '../../ui/persist/persistedStore';
import { downloadBlob, fileStem } from '../../ui/plot/export';
import type { AnalysisRecord } from '../../ui/report/record';
import {
  combinedMethods,
  sampleReportMarkdown,
  type ReportPart,
} from '../../ui/report/sampleReport';
import { ftirStore } from '../ftir/ftirStore';
import { ftirRecord } from '../ftir/record';
import { calcinationOf, useThermalView } from '../thermal/analysis';
import { tgaStore } from '../thermal/tgaStore';
import { uvvisRecord } from '../uvvis/record';
import { uvvisStore } from '../uvvis/uvvisStore';
import { comparisonRows } from '../xrd/comparison';
import { xrdRecord } from '../xrd/record';
import { useCandidatePhases } from '../xrd/useReferencePhases';
import { xrdStore } from '../xrd/xrdStore';
import '../xrd/xrd.css';
import '../../ui/about.css';
import { thermalPart } from './thermalPart';

const SAMPLE_KEY = 'sample-report-name';

/** A tool's record as a report part. Sections with a long list of fitted peaks are left to the tool's own record. */
const partOf = (
  tool: string,
  record: AnalysisRecord,
  example: boolean,
  keep: (title: string) => boolean = () => true,
): ReportPart => ({
  tool,
  data: record.data.map((d) => d.name),
  example,
  results: record.results.filter((r) => keep(r.title)),
  methods: record.methods,
});

const TOOLS = [
  { tool: 'XRD', href: '#/xrd' },
  { tool: 'FTIR', href: '#/ftir' },
  { tool: 'UV-Vis', href: '#/uvvis' },
  { tool: 'Thermal analysis (TGA)', href: '#/thermal' },
] as const;

/**
 * The sample report page: collects what is open in the XRD, FTIR, UV-Vis and thermal tools in
 * this browser into one summary with one methods section, for a sample measured by several
 * techniques.
 */
export default function SampleReport() {
  const xrd = useStore(xrdStore);
  const ftir = useStore(ftirStore);
  const uvvis = useStore(uvvisStore);
  const thermal = useStore(tgaStore);
  const loading = [xrd, ftir, uvvis, thermal].some((s) => s.status === 'loading');

  const xrdData = xrd.state.data;
  const ftirData = ftir.state.data;
  const uvvisData = uvvis.state.data;
  const thermalData = thermal.state.data;
  const { phases } = useCandidatePhases(xrdData.material);

  // The three records are written asynchronously (they fingerprint the data).
  const [records, setRecords] = useState<ReportPart[]>([]);
  useEffect(() => {
    let current = true;
    void (async () => {
      const parts: ReportPart[] = [];
      if (xrdData.patterns.length > 0) {
        const part = partOf(
          'XRD',
          await xrdRecord(xrdData, phases ?? []),
          xrdData.patterns.some((p) => p.synthetic),
          (title) => !title.startsWith('Fitted peaks'),
        );
        const cells = comparisonRows(xrdData, phases).flatMap((r) =>
          r.phase && r.volume
            ? [
                `${r.name}: ${r.phase}, ${r.edges.map((e) => `${e.name} = ${formatWithSigma(e.a.value, e.a.sigma)} Å`).join(', ')}, V = ${formatWithSigma(r.volume.value, r.volume.sigma)} Å³`,
              ]
            : [],
        );
        if (cells.length > 0)
          part.results.push({ title: 'Phase and refined cell (estimates)', lines: cells });
        parts.push(part);
      }
      if (ftirData.spectra.length > 0)
        parts.push(
          partOf(
            'FTIR',
            await ftirRecord(ftirData),
            ftirData.spectra.some((s) => s.synthetic),
          ),
        );
      if (uvvisData.spectra.length > 0)
        parts.push(
          partOf(
            'UV-Vis',
            await uvvisRecord(uvvisData),
            uvvisData.spectra.some((s) => s.synthetic),
          ),
        );
      if (current) setRecords(parts);
    })();
    return () => {
      current = false;
    };
  }, [xrdData, ftirData, uvvisData, phases]);

  const { curve, view } = useThermalView(thermalData);
  const tga = useMemo(() => {
    if (!curve || !view) return null;
    const steps = view.analysis.steps;
    return thermalPart(thermalData, view, steps, calcinationOf(thermalData, curve, steps));
  }, [thermalData, curve, view]);
  const parts = useMemo(() => (tga ? [...records, tga] : records), [records, tga]);

  const [sample, setSample] = useState(() => {
    try {
      return localStorage.getItem(SAMPLE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const rename = (name: string) => {
    setSample(name);
    try {
      localStorage.setItem(SAMPLE_KEY, name);
    } catch {
      // The name is a convenience; the report works without storage.
    }
  };
  const [status, setStatus] = useState('');
  const methods = combinedMethods(parts);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setStatus('Methods text copied.');
    } catch {
      setStatus('Copying is blocked in this browser. Select the text and copy it by hand.');
    }
  };
  const download = () => {
    const name = `${fileStem(sample.trim() || 'sample')}-report.md`;
    const text = sampleReportMarkdown(sample, parts, new Date().toISOString());
    downloadBlob(new Blob([text], { type: 'text/markdown' }), name);
    setStatus(`Saved ${name}.`);
  };
  const missing = TOOLS.filter((t) => !parts.some((p) => p.tool === t.tool));

  return (
    <div class="about">
      <h1>Sample report</h1>
      <p>
        One sample is usually measured by several techniques. This page collects what is open in the
        XRD, FTIR, UV-Vis and thermal tools in this browser into one summary with a single methods
        section. It reads your saved analyses on this device; nothing is uploaded.
      </p>
      <p class="message">
        <strong>Check that every analysis belongs to the same sample.</strong> The page cannot know
        which sample a file came from. Every value is an estimate from a model; read each tool's own
        warnings before you report a number.
      </p>
      <label class="inline-field">
        Sample name
        <input
          type="text"
          value={sample}
          placeholder="for example ZnO, calcined at 500 °C"
          onInput={(e) => rename(e.currentTarget.value)}
        />
      </label>

      {loading ? (
        <p role="status">Reading your saved analyses…</p>
      ) : (
        <>
          {parts.some((p) => p.example) && (
            <p class="message is-warning" role="note">
              <strong>Check:</strong>{' '}
              {parts
                .filter((p) => p.example)
                .map((p) => p.tool)
                .join(', ')}{' '}
              used generated example data, not measurements. Do not report those results.
            </p>
          )}
          {parts.map((part) => (
            <section key={part.tool} class="process-step is-on" aria-label={part.tool}>
              <h2 class="process-step-title">{part.tool}</h2>
              <p class="field-hint">Data: {part.data.join('; ')}</p>
              {part.results.length === 0 && <p>No results yet. Finish the analysis in the tool.</p>}
              {part.results.map((section) => (
                <div key={section.title}>
                  <h3 class="export-title">{section.title}</h3>
                  <ul>
                    {section.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
          {missing.length > 0 && (
            <section aria-labelledby="report-missing">
              <h2 id="report-missing">Not in this report yet</h2>
              <ul>
                {missing.map((t) => (
                  <li key={t.tool}>
                    <a href={t.href}>{t.tool}</a>: no analysis is open in this browser.
                  </li>
                ))}
              </ul>
            </section>
          )}
          {parts.length > 0 && (
            <section aria-labelledby="report-methods">
              <h2 id="report-methods">Methods</h2>
              <p class="field-hint">
                Written from the settings each tool used. Edit it to fit your paper, and add the
                instrument details the files do not contain.
              </p>
              {parts.map((p) => (
                <p key={p.tool}>{p.methods}</p>
              ))}
              <div class="export-actions">
                <button type="button" class="btn" onClick={() => void copy()}>
                  Copy methods text
                </button>
                <button type="button" class="btn btn-primary" onClick={download}>
                  Download the report (.md)
                </button>
              </div>
              <p class="export-status" role="status">
                {status}
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
