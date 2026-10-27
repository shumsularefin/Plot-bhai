import './home.css';

interface ToolCard {
  name: string;
  description: string;
  /** Hash route; tools without one are not built yet. */
  href?: string;
}

const TOOLS: readonly ToolCard[] = [
  {
    name: 'XRD',
    description:
      'Clean a diffraction pattern, compare reference phases, fit peaks and size crystallites.',
    href: '#/xrd',
  },
  {
    name: 'XRD from a screenshot',
    description:
      'Only have a figure from a paper? Digitize its pattern, then check the reported crystallite sizes.',
    href: '#/xrd-screenshot',
  },
  {
    name: 'UV-Vis',
    description: 'Absorbance, transmittance and reflectance spectra, with Tauc band gap estimates.',
    href: '#/uvvis',
  },
  {
    name: 'FTIR',
    description:
      'Absorbance and transmittance spectra, peak tables and functional group suggestions.',
    href: '#/ftir',
  },
  {
    name: 'Particle size',
    description: 'Measure particles in SEM or TEM images and build a size distribution.',
    href: '#/particles',
  },
  {
    name: 'TGA and DSC',
    description:
      'Mass loss steps, thermal events, enthalpies, glass transition, calcination suggestions and activation energy.',
    href: '#/thermal',
  },
];

export function Home() {
  return (
    <div class="home">
      <h1 class="page-title">Analyse your characterisation data</h1>
      <p class="page-lead">
        Step-by-step tools for materials researchers. Everything runs in your browser; your files
        never leave your device.
      </p>
      <ul class="tool-grid">
        {TOOLS.map((tool) => (
          <li key={tool.name} class={`tool-card${tool.href ? '' : ' is-soon'}`}>
            <h2 class="tool-name">
              {tool.href ? (
                <a href={tool.href} class="tool-link">
                  {tool.name}
                </a>
              ) : (
                tool.name
              )}
            </h2>
            <p class="tool-description">{tool.description}</p>
            {tool.href ? (
              <span class="tool-cta" aria-hidden="true">
                Start →
              </span>
            ) : (
              <span class="tool-badge">Coming soon</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
