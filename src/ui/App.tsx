import About from './About';
import { useEffect } from 'preact/hooks';
import { ErrorBoundary } from './ErrorBoundary';
import { recordVisit } from './feedback/client';
import { Home } from './Home';
import { LazyTool } from './LazyTool';
import { AppHeader } from './AppHeader';
import { recordSession, TOOL_NAMES } from './lastSession';
import { currentSection, useHashPath } from './router';
import { StatusBar } from './StatusBar';

// Defined once at module level so LazyTool does not reload it on every render.
const loadXrd = () => import('../modules/xrd/XrdTool');
const loadUvvis = () => import('../modules/uvvis/UvvisTool');
const loadFtir = () => import('../modules/ftir/FtirTool');
const loadParticles = () => import('../modules/particles/ParticlesTool');
const loadThermal = () => import('../modules/thermal/ThermalTool');
const loadXrdImage = () => import('../modules/digitize/targets/xrd');
const loadFtirImage = () => import('../modules/digitize/targets/ftir');
const loadUvvisImage = () => import('../modules/digitize/targets/uvvis');
const loadThermalImage = () => import('../modules/digitize/targets/thermal');
const loadValidation = () => import('./Validation');
const loadReport = () => import('../modules/report/SampleReport');

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Plot Bhai',
  '/xrd': 'XRD — Plot Bhai',
  '/uvvis': 'UV-Vis — Plot Bhai',
  '/ftir': 'FTIR — Plot Bhai',
  '/particles': 'Particle size — Plot Bhai',
  '/thermal': 'Thermal (TGA & DSC) — Plot Bhai',
  '/report': 'Sample report — Plot Bhai',
  '/validation': 'Validation — Plot Bhai',
  '/about': 'About — Plot Bhai',
};

/** Routes that open a tool: these fill the window with the tool's workbench, without site chrome. */
const isToolRoute = (path: string) => path in TOOL_NAMES || path === '/xrd-screenshot';

function routeView(path: string) {
  switch (path) {
    case '/about':
      return <About />;
    case '/validation':
      return <LazyTool load={loadValidation} />;
    case '/report':
      return <LazyTool load={loadReport} />;
    case '/xrd':
      return <LazyTool load={loadXrd} />;
    case '/xrd/image':
    case '/xrd-screenshot':
      return <LazyTool load={loadXrdImage} />;
    case '/ftir/image':
      return <LazyTool load={loadFtirImage} />;
    case '/uvvis/image':
      return <LazyTool load={loadUvvisImage} />;
    case '/thermal/image':
      return <LazyTool load={loadThermalImage} />;
    case '/uvvis':
      return <LazyTool load={loadUvvis} />;
    case '/ftir':
      return <LazyTool load={loadFtir} />;
    case '/particles':
      return <LazyTool load={loadParticles} />;
    case '/thermal':
      return <LazyTool load={loadThermal} />;
    default:
      return <Home />;
  }
}

/**
 * Skip link. A plain "#id" link would change the hash route, so this moves focus itself.
 */
function SkipLink({ target, children }: { target: string; children: string }) {
  return (
    <a
      class="skip-link"
      href={`#${target}`}
      onClick={(event) => {
        const el = document.getElementById(target);
        if (!el) return;
        event.preventDefault();
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus();
      }}
    >
      {children}
    </a>
  );
}

/** "#/about?about-cite" scrolls to that section once the page is drawn. */
function scrollToSection() {
  const id = currentSection();
  if (!id) return;
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView?.({ block: 'start' }));
}

export function App() {
  const path = useHashPath();
  const tool = isToolRoute(path);
  useEffect(recordVisit, []);
  useEffect(() => {
    document.title = ROUTE_TITLES[path] ?? 'Plot Bhai';
    window.scrollTo?.(0, 0);
    recordSession(path);
    scrollToSection();
  }, [path]);
  useEffect(() => {
    window.addEventListener('hashchange', scrollToSection);
    return () => window.removeEventListener('hashchange', scrollToSection);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('is-workbench', tool);
  }, [tool]);

  if (tool) {
    return (
      <div class="shell is-tool">
        <SkipLink target="wizard-step-heading">Skip to the current step</SkipLink>
        <main id="main-content" class="tool-main">
          <ErrorBoundary key={path}>{routeView(path)}</ErrorBoundary>
        </main>
      </div>
    );
  }

  return (
    <div class="shell">
      <SkipLink target="main-content">Skip to content</SkipLink>
      <AppHeader />
      <main id="main-content" class="site-main">
        <div class="container">
          <ErrorBoundary key={path}>{routeView(path)}</ErrorBoundary>
        </div>
      </main>
      <StatusBar path={path} />
    </div>
  );
}
