import type { ComponentChildren } from 'preact';
import { Community } from './feedback/Community';
// A figure exported by the XRD tool from its example data, unedited (see the caption below).
import exampleFigure from './home-figure.svg';
import './home.css';

interface ToolCard {
  name: string;
  description: string;
  href: string;
  /** True when the tool also reads a curve from a picture of a graph. */
  fromImage: boolean;
  /** Simple line drawing for the card, 24 × 24 units. */
  icon: ComponentChildren;
}

const TOOLS: readonly ToolCard[] = [
  {
    name: 'XRD',
    description:
      'Clean a diffraction pattern, compare reference phases, fit peaks and work out crystallite size and strain.',
    href: '#/xrd',
    fromImage: true,
    icon: <path d="M2 20h20M3 18h2l1-9 1 9h3l1.5-14L13 18h3l1-6 1 6h3" />,
  },
  {
    name: 'FTIR',
    description:
      'Absorbance and transmittance spectra, peak tables and functional group suggestions.',
    href: '#/ftir',
    fromImage: true,
    icon: <path d="M2 4h3l1.5 9L8 4h3l1 5 1.5-5h2l1.5 12L18.5 4H22M2 20h20" />,
  },
  {
    name: 'UV-Vis',
    description: 'Absorbance, transmittance and reflectance spectra, with Tauc band gap estimates.',
    href: '#/uvvis',
    fromImage: true,
    icon: <path d="M2 20h20M3 4c4 0 5 1 7 5s3 9 11 9" />,
  },
  {
    name: 'TGA and DSC',
    description:
      'Mass loss steps, thermal events, enthalpies, glass transition, calcination suggestions and activation energy.',
    href: '#/thermal',
    fromImage: true,
    icon: <path d="M2 20h20M3 5h5c2 0 2 5 4 5h3c2 0 2 6 4 6h2" />,
  },
  {
    name: 'Particle size',
    description: 'Measure particles in SEM or TEM images and build a size distribution.',
    href: '#/particles',
    fromImage: false,
    icon: (
      <>
        <circle cx="8" cy="9" r="4" />
        <circle cx="16.5" cy="15" r="5" />
        <circle cx="17" cy="5" r="2" />
      </>
    ),
  },
];

const STEPS = [
  {
    title: 'Load your data',
    text: 'A data file from the instrument (CSV, TXT and common instrument formats), or a picture of a graph from a paper.',
  },
  {
    title: 'Follow the steps',
    text: 'Each step does one thing, with sensible defaults, short tips and Undo. Your work is saved in this browser as you go.',
  },
  {
    title: 'Export for your paper',
    text: 'Publication-quality figures (SVG, PNG, PDF), tables as CSV and a methods paragraph written from your settings.',
  },
];

export function Home() {
  return (
    <div class="home">
      <section class="home-hero" aria-labelledby="home-title">
        <h1 id="home-title" class="home-title">
          Plot Bhai
        </h1>
        <p class="home-tagline">
          Analyse your materials characterisation data step by step, and get figures, tables and
          methods text ready for your paper.
        </p>
        <ul class="home-points">
          <li>Runs in your browser: files never leave your device</li>
          <li>Free, no account</li>
          <li>Works with data files or pictures of graphs</li>
        </ul>
      </section>

      <section aria-labelledby="home-tools">
        <h2 id="home-tools" class="home-section-title">
          Choose a tool
        </h2>
        <ul class="tool-grid">
          {TOOLS.map((tool) => (
            <li key={tool.name} class="tool-card">
              <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
                {tool.icon}
              </svg>
              <h3 class="tool-name">
                <a href={tool.href} class="tool-link">
                  {tool.name}
                </a>
              </h3>
              <p class="tool-description">{tool.description}</p>
              <p class="tool-inputs">
                {tool.fromImage ? 'Data file or graph image' : 'SEM or TEM image'}
              </p>
              <span class="tool-cta" aria-hidden="true">
                Start →
              </span>
            </li>
          ))}
          <li class="tool-card is-note">
            <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 3h9l4 4v14H6zM9 11h7M9 15h7M9 7h3" />
            </svg>
            <h3 class="tool-name">
              <a href="#/report" class="tool-link">
                Sample report
              </a>
            </h3>
            <p class="tool-description">
              One sample, several techniques: the results of your XRD, FTIR, UV-Vis and thermal
              analyses in one summary with a single methods section.
            </p>
            <span class="tool-cta" aria-hidden="true">
              Combine →
            </span>
          </li>
          <li class="tool-card is-note">
            <svg class="tool-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
            <h3 class="tool-name">
              <a href="#/validation" class="tool-link">
                How this is validated
              </a>
            </h3>
            <p class="tool-description">
              Each numerical method is checked on data with a known answer and against another
              program or a published example. The checks, their tolerances and what is still open
              are public.
            </p>
            <span class="tool-cta" aria-hidden="true">
              Read the checks →
            </span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="home-figure" class="home-example">
        <div>
          <h2 id="home-figure" class="home-section-title">
            What you get
          </h2>
          <p>
            A figure sized for a journal column, with indexed peaks and the reference pattern named
            by its database number, plus the tables and a methods paragraph that states the
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
            tool's example data: calculated from the zinc oxide structure COD 1577381, not measured.
          </figcaption>
        </figure>
      </section>

      <section aria-labelledby="home-how" class="home-how">
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

      <Community />

      <p class="home-credit">
        Designed and developed by Shumsul Arefin, Gopalganj Science and Technology University.{' '}
        <a href="#/about">Credits, equations and limits</a>
      </p>
    </div>
  );
}
