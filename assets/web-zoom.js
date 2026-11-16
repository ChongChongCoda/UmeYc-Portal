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
  });
  // Fold native pinch into page zoom before the backend resets the pinch viewport.
  const current = state.factor * (window.visualViewport?.scale || 1);
  const factor = action === 'default' ? 1 : Math.max(.25, Math.min(3,
    action === 'smaller' ? current / 1.2 : current * 1.2));
  const { scrollX: x, scrollY: y } = window;
  if (factor === 1) {
    if (state.original) root.style.setProperty('zoom', state.original, state.priority);
    else root.style.removeProperty('zoom');
  } else root.style.setProperty('zoom', String(state.base * factor), 'important');
  window.scrollTo(x * factor / state.factor, y * factor / state.factor);
  state.factor = factor;
  return { factor };
})();
