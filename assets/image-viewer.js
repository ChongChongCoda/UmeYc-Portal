/* Session-only reading position and event-driven right-stick scrolling. */
(() => {
  const image = document.getElementById('guide');
  const area = document.querySelector('main');
  const token = area.dataset.token;
  let state = JSON.parse(area.dataset.state);
  let restoring = false;
  let saveTimer;
  let motion = { x: 0, y: 0 };
  let expiresAt = 0;
  let animation = 0;
  let previousFrame = 0;

  function remember() {
    if (restoring || !image.width) return;
    state = { zoom: state.zoom, top: area.scrollTop / image.width, left: area.scrollLeft / image.width };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 150);
  }

  function save() {
    navigator.sendBeacon('/state/' + token, JSON.stringify(state));
  }

  function restore() {
    if (!image.complete || !image.naturalWidth) return;
    restoring = true;
    image.style.width = (state.zoom * 100) + '%';
    area.scrollTop = state.top * image.width;
    area.scrollLeft = state.left * image.width;
    requestAnimationFrame(() => { restoring = false; });
  }

  function zoom(value) {
    remember();
    state.zoom = Math.min(8, Math.max(0.25, value));
    restore();
    save();
  }

  function frame(now) {
    animation = 0;
    if (now >= expiresAt || document.hidden || (!motion.x && !motion.y)) {
      previousFrame = 0;
      return;
    }
    const seconds = previousFrame ? Math.min(0.05, (now - previousFrame) / 1000) : 0;
    previousFrame = now;
    area.scrollBy(motion.x * 700 * seconds, motion.y * 700 * seconds);
    animation = requestAnimationFrame(frame);
  }

  const events = new EventSource('/events/' + token);
  events.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.zoom) {
      const button = { smaller: 'smaller', default: 'fit', larger: 'larger' }[message.zoom];
      if (button) document.getElementById(button).click();
      return;
    }
    motion = message;
    expiresAt = performance.now() + 350;
    if (!animation && (motion.x || motion.y)) animation = requestAnimationFrame(frame);
  };
  events.onerror = () => { motion = { x: 0, y: 0 }; };
  document.addEventListener('visibilitychange', () => {
    motion = { x: 0, y: 0 };
    remember();
    save();
  });
  window.addEventListener('pagehide', () => { remember(); save(); events.close(); });
  area.addEventListener('scroll', remember, { passive: true });
  // Keep the same point in the image when switching between small/full/sidebar layouts.
  new ResizeObserver(restore).observe(area);
  image.addEventListener('load', restore);
  restore();
  document.getElementById('smaller').onclick = () => zoom(state.zoom / 1.4);
  document.getElementById('larger').onclick = () => zoom(state.zoom * 1.4);
  document.getElementById('fit').onclick = () => zoom(1);
  image.onerror = () => { image.hidden = true; document.getElementById('error').style.display = 'block'; };
})();
