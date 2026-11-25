import { useState } from 'preact/hooks';
import { TOOL_GROUPS, type ToolEntry } from './catalog';
import { Community } from './feedback/Community';
// A figure exported by the XRD tool from its example data, unedited (see the caption below).
import exampleFigure from './home-figure.svg';
import { readSession, timeAgo } from './lastSession';
import './home.css';

const STEPS = [
  {
    title: 'Load your data',
    text: 'A data file from the instrument (CSV, TXT and common instrument formats), or a picture of a graph from a paper.',
  },
  {
    title: 'Follow the steps',
    text: 'Each tab does one thing, with sensible defaults, short tips and Undo. Your work is saved in this browser as you go.',
  },
  {
    title: 'Export for your paper',
    text: 'Publication-quality figures (SVG, PNG, PDF), tables as CSV and a methods paragraph written from your settings.',
  },
];

/** Picks up the tool last used; on a first visit, says what the site is instead. */
function ResumeBar() {
  const [session] = useState(readSession);
  if (!session) {
    return (
      <section class="resume-bar is-intro" aria-labelledby="home-title">
        <div class="resume-text">
          <h1 id="home-title" class="resume-title">
            Plot Bhai
          </h1>
          <p>
            Analyse materials characterisation data step by step, and get figures, tables and
            methods text ready for your paper. Free, no account, and your files never leave this
            device.
          </p>
        </div>
        <a class="btn btn-primary resume-action" href="#/xrd">
          Try an example
        </a>
      </section>
    );
  }
  return (
    <section class="resume-bar" aria-labelledby="home-title">
      <h1 id="home-title" class="visually-hidden">
        Plot Bhai
      </h1>
      <svg class="resume-icon" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 3.5a6.5 6.5 0 1 1-6.3 8.1M3.5 4.5v3.8h3.8M10 6.5V10l2.5 1.6" />
      </svg>
      <p class="resume-text">
        <strong>Resume last session:</strong> {session.name}{' '}
        <span class="resume-time">(opened {timeAgo(session.at)})</span>
      </p>
      <a class="btn btn-primary resume-action" href={`#${session.path}`}>
        Quick launch
      </a>
    </section>
  );
}

function ToolCard({ tool }: { tool: ToolEntry }) {
  return (
    <li class={`tool-card${tool.links ? ' has-links' : ''}`}>
      <svg class="tool-icon" viewBox="0 0 48 48" aria-hidden="true">
        {tool.icon}
      </svg>
      <div class="tool-body">
        <div class="tool-name-row">
          <h3 class="tool-name">
            <a href={tool.href} class="tool-link">
              {tool.name}
            </a>
          </h3>
          <span class="tool-badge">{tool.badge}</span>
        </div>
        <p class="tool-features">{tool.features}</p>
        <p class="tool-description">{tool.description}</p>
        {tool.links && (
          <p class="tool-chips">
            <span class="visually-hidden">Open for:</span>
            {tool.links.map((l) => (
              <a key={l.href} href={l.href} class="tool-chip">
                {l.label}
              </a>
            ))}
          </p>
        )}
      </div>
    </li>
  );
}

export function Home() {
  return (
    <div class="home">
      <ResumeBar />

      <div class="tool-groups">
        {TOOL_GROUPS.map((group) => {
          const id = `home-${group.title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
          return (
            <section key={group.title} class="tool-group" aria-labelledby={id}>
              <h2 id={id} class="home-section-title">
                {group.title}
              </h2>
              <ul class="tool-grid">
                {group.tools.map((tool) => (
                  <ToolCard key={tool.name} tool={tool} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div class="home-more">
        <section aria-labelledby="home-figure" class="home-card home-example">
          <div>
            <h2 id="home-figure" class="home-section-title">
              What you get
            </h2>
            <p>
              A figure sized for a journal column, with indexed peaks and the reference pattern
              named by its database number, plus the tables and a methods paragraph that states the
              equations and settings actually used.
            </p>
            <p>
              <a href="#/xrd">Try the XRD tool with example data</a>
            </p>
          </div>
          <figure class="home-figure">
            <img
              src={exampleFigure}
              width="482"
              height="369"
              loading="lazy"
              alt="X-ray diffraction patterns of zinc oxide between 20 and 80 degrees two-theta, with each peak labelled by its Miller indices and the reference lines of COD entry 1577381 below."
            />
            <figcaption>
              Exported by the XRD tool, unedited (single column, 85 mm). The two patterns are the
              tool's example data: calculated from the zinc oxide structure COD 1577381, not
              measured.
            </figcaption>
          </figure>
        </section>

        <section aria-labelledby="home-how" class="home-card home-how">
          <h2 id="home-how" class="home-section-title">
            How it works
          </h2>
          <ol class="home-steps">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <Community />

      <p class="home-credit">
        Designed and developed by Shumsul Arefin, Gopalganj Science and Technology University. ©
        2026, open source under the MIT licence. <a href="#/about">Credits, equations and limits</a>
      </p>
    </div>
  );
}
