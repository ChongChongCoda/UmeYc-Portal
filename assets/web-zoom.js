/* Called only when a Portal toolbar button is pressed. No page scripts or timers persist. */
(() => {
  const action = __PORTAL_ZOOM_ACTION__;
  const root = document.documentElement;
  const key = Symbol.for('umeyc.portal.pageZoom');
  const state = root[key] || (root[key] = {
    factor: 1,
    original: root.style.getPropertyValue('zoom'),
    priority: root.style.getPropertyPriority('zoom'),
    base: parseFloat(getComputedStyle(root).zoom) || 1,
    shells: null,
    shellMin: null,
  });
  // Fold native pinch into page zoom before the backend resets the pinch viewport.
  const current = state.factor * (window.visualViewport?.scale || 1);
  const factor = action === 'default' ? 1 : Math.max(.25, Math.min(3,
    action === 'smaller' ? current / 1.2 : current * 1.2));
  const { scrollX: x, scrollY: y } = window;

  // CSS zoom does not change viewport units, so an app shell sized with 100vh
  // shrinks and leaves the bottom of the reader blank. Remember full-screen
  // containers before the first change and stretch their minimum height back
  // to the visual viewport while zoomed out. Browser zoom reflows viewport
  // units the same way; this reproduces that effect without reloading.
  if (!state.shells && typeof document.elementFromPoint === 'function') {
    const shells = new Set();
    const points = [
      [innerWidth / 2, 4],
      [innerWidth / 2, innerHeight / 2],
      [innerWidth / 2, innerHeight - 4],
      [4, innerHeight / 2],
      [innerWidth - 4, innerHeight / 2],
    ];
    for (const [px, py] of points) {
      let element = document.elementFromPoint(px, py);
      while (element) {
        const rect = element.getBoundingClientRect();
        if (rect.height >= innerHeight * 0.9 && rect.width >= innerWidth * 0.9) {
          shells.add(element);
        }
        element = element.parentElement;
      }
    }
    state.shells = [...shells];
    state.shellMin = state.shells.map((element) => [
      element,
      element.style.getPropertyValue('min-height'),
      element.style.getPropertyPriority('min-height'),
    ]);
  }

  if (factor === 1) {
    if (state.original) root.style.setProperty('zoom', state.original, state.priority);
    else root.style.removeProperty('zoom');
  } else root.style.setProperty('zoom', String(state.base * factor), 'important');
  for (const [element, minHeight, priority] of state.shellMin || []) {
    if (!element.isConnected) continue;
    if (factor < 1) {
      element.style.setProperty('min-height', `calc(100vh / ${factor})`, 'important');
    } else if (minHeight) {
      element.style.setProperty('min-height', minHeight, priority);
    } else {
      element.style.removeProperty('min-height');
    }
  }
  window.scrollTo(x * factor / state.factor, y * factor / state.factor);
  state.factor = factor;
  return { factor };
})();
