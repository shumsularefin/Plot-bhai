// Applies the saved theme before first paint to avoid a flash of the wrong theme.
// Kept as a tiny external file because the Content Security Policy forbids inline scripts.
// Must match src/ui/theme.ts.
try {
  const theme = localStorage.getItem('xrdtk-theme');
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  }
} catch {
  // Storage blocked: fall back to the system theme.
}
