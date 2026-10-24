import { Home } from './Home';
import { LazyTool } from './LazyTool';
import { useHashPath } from './router';
import { ThemeToggle } from './ThemeToggle';

// Defined once at module level so LazyTool does not reload it on every render.
const loadXrd = () => import('../modules/xrd/XrdTool');
const loadUvvis = () => import('../modules/uvvis/UvvisTool');
const loadFtir = () => import('../modules/ftir/FtirTool');

export function App() {
  const path = useHashPath();

  return (
    <div class="shell">
      <header class="site-header">
        <div class="container">
          <a href="#/" class="brand">
            XRD Toolkit
          </a>
          <ThemeToggle />
        </div>
      </header>
      <main class="site-main">
        <div class="container">
          {path === '/xrd' ? (
            <LazyTool load={loadXrd} />
          ) : path === '/uvvis' ? (
            <LazyTool load={loadUvvis} />
          ) : path === '/ftir' ? (
            <LazyTool load={loadFtir} />
          ) : (
            <Home />
          )}
        </div>
      </main>
      <footer class="site-footer">
        <div class="container">
          <p>Free and open. Your data stays on your device.</p>
        </div>
      </footer>
    </div>
  );
}
