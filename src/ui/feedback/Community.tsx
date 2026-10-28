import { useEffect, useState } from 'preact/hooks';
import { fetchComments, fetchStats, type PublicComment, type Stats } from './client';
import './feedback.css';

const COUNTERS: [keyof Stats, string][] = [
  ['visits', 'Visits'],
  ['analyses', 'Analyses finished'],
  ['validations', 'Validations'],
];

/**
 * Home page section with the visit, analysis and validation counters and the comments the owner
 * has approved. Hidden while the feedback service cannot be reached.
 */
export function Community() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [comments, setComments] = useState<PublicComment[]>([]);
  useEffect(() => {
    let live = true;
    void fetchStats().then((s) => live && setStats(s));
    void fetchComments().then((c) => live && setComments(c ?? []));
    return () => {
      live = false;
    };
  }, []);
  if (!stats) return null;

  return (
    <section aria-labelledby="home-community" class="home-community">
      <h2 id="home-community" class="home-section-title">
        Testing so far
      </h2>
      <p>
        These tools are an early testing version. After finishing an analysis, press{' '}
        <strong>Validate</strong> to say whether it worked for your data.
      </p>
      <ul class="home-counters">
        {COUNTERS.map(([key, label]) => (
          <li key={key}>
            <span class="home-counter-value">{stats[key].toLocaleString('en')}</span>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {comments.length > 0 && (
        <>
          <h3>Comments from testers</h3>
          <ul class="home-comments">
            {comments.map((c) => (
              <li key={c.id}>
                <p class="field-hint">
                  {c.tool} · {c.verdict === 'works' ? 'It worked' : 'Something is wrong'} ·{' '}
                  {c.created.slice(0, 10)}
                </p>
                <p>{c.comment}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
