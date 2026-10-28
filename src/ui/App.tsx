import About from './About';
import { useEffect } from 'preact/hooks';
import { ErrorBoundary } from './ErrorBoundary';
import { recordVisit } from './feedback/client';
import { Home } from './Home';
import { LazyTool } from './LazyTool';
import { useHashPath } from './router';
import { ThemeToggle } from './ThemeToggle';

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

export function App() {
  const path = useHashPath();
  useEffect(recordVisit, []);

  return (
    <div class="shell">
      <header class="site-header">
        <div class="container">
          <a href="#/" class="brand">
            <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 20h18M4 17c3 0 3-9 6-9s3 6 5 6 2-8 5-8" />
            </svg>
            Plot Bhai
          </a>
          <nav class="site-nav" aria-label="Site">
            <a href="#/about">About</a>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main class="site-main">
        <div class="container">
          <ErrorBoundary key={path}>
            {path === '/about' ? (
              <About />
            ) : path === '/xrd' ? (
              <LazyTool load={loadXrd} />
            ) : path === '/xrd/image' || path === '/xrd-screenshot' ? (
              <LazyTool load={loadXrdImage} />
            ) : path === '/ftir/image' ? (
              <LazyTool load={loadFtirImage} />
            ) : path === '/uvvis/image' ? (
              <LazyTool load={loadUvvisImage} />
            ) : path === '/thermal/image' ? (
              <LazyTool load={loadThermalImage} />
            ) : path === '/uvvis' ? (
              <LazyTool load={loadUvvis} />
            ) : path === '/ftir' ? (
              <LazyTool load={loadFtir} />
            ) : path === '/particles' ? (
              <LazyTool load={loadParticles} />
            ) : path === '/thermal' ? (
              <LazyTool load={loadThermal} />
            ) : (
              <Home />
            )}
          </ErrorBoundary>
        </div>
      </main>
      <footer class="site-footer">
        <div class="container">
          <p>© 2026 Shumsul Arefin. All rights reserved.</p>
          <p>
            Free to use. Your data stays on your device.{' '}
            <a href="#/about">About, equations and limits</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
