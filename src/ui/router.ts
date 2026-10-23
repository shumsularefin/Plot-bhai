import { useEffect, useState } from 'preact/hooks';

/**
 * Minimal hash router. Hash URLs (#/xrd) need no server rewrites on Firebase Hosting.
 * Returns the current path without the leading "#", always starting with "/".
 */
export function currentPath(): string {
  const path = window.location.hash.replace(/^#/, '');
  return path.startsWith('/') ? path : '/';
}

export function useHashPath(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onChange = () => setPath(currentPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}
