/**
 * Sliders draw a blue track up to their knob (see base.css). CSS cannot read a range input's
 * value, so this keeps a --p custom property (percent) on every slider: when it is moved, and
 * after the page changes (Preact sets the value as a property, which no observer sees, but a
 * changed value always comes with some other change on the page, such as its number box).
 */
function fill(input: HTMLInputElement) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value);
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const text = `${Math.min(100, Math.max(0, percent))}%`;
  if (input.style.getPropertyValue('--p') !== text) input.style.setProperty('--p', text);
}

function fillAll() {
  document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(fill);
}

export function startRangeFill(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'range') fill(target);
  });
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fillAll();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  fillAll();
}
