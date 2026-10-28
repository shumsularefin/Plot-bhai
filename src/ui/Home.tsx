import type { ComponentChildren } from 'preact';
import { Community } from './feedback/Community';
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
        </ul>
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
    </div>
  );
}
