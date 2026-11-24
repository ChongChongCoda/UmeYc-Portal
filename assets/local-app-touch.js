/* Portal touch gestures for the local atlas.
 *
 * The atlas only implements single-pointer drag and wheel zoom. This shim
 * adds smartphone-style pinch zoom and two-finger pan without modifying the
 * atlas files. One-finger drag/tap is left to the app's native pointer
 * handlers.
 */
(() => {
  'use strict';

  const page = (location.pathname.split('/').pop() || '').toLowerCase();
  const world = page === 'world.html';
  const mapPage = page === 'index.html' || world;

  function hint(text) {
    const node = document.createElement('div');
    node.textContent = text;
    node.style.cssText =
      'position:fixed;left:50%;top:18%;transform:translate(-50%,-50%);z-index:2147483647;' +
      'background:#20303f;color:#fff;padding:10px 16px;border-radius:8px;font:14px sans-serif;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.4)';
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 1800);
  }

  function neutralizeSearchInputs() {
    document
      .querySelectorAll('#search, #query, input[type="search"]')
      .forEach((input) => {
        if (input.dataset.portalSearch === '1') return;
        input.dataset.portalSearch = '1';
        input.readOnly = true;
        input.title = '请使用顶部「搜索」按钮';
        input.addEventListener(
          'pointerdown',
          (event) => {
            event.preventDefault();
            hint('请使用顶部「搜索」按钮');
          },
          { capture: true },
        );
        input.addEventListener('focus', () => hint('请使用顶部「搜索」按钮'), {
          capture: true,
        });
      });
  }

  neutralizeSearchInputs();

  const attach = () => {
    const canvas = document.getElementById('map');
    if (!canvas || canvas.dataset.portalTouch === '1') return;
    canvas.dataset.portalTouch = '1';

    const style = document.createElement('style');
    style.textContent = '#map, #scene { touch-action: none !important; }';
    document.head.appendChild(style);

    const zoomFactor = world ? 0.0015 : 0.0025;
    const panButton = world ? 2 : 0;
    const panButtons = world ? 2 : 1;
    const counts = { pinch: 0, pan: 0 };
    window.__portalTouch = counts;

    let firstId = null;
    let multi = false;
    let lastDistance = 0;
    let lastMid = null;
    let dragging = false;
    let patched = false;
    const nativeSetCapture = canvas.setPointerCapture.bind(canvas);
    const nativeReleaseCapture = canvas.releasePointerCapture.bind(canvas);

    const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const midpoint = (a, b) => ({
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    });
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const walking = () => {
      if (!world) return false;
      const controls = document.getElementById('streetControls');
      return !!controls && !controls.hidden;
    };

    function patchCapture() {
      if (patched) return;
      canvas.setPointerCapture = () => {};
      canvas.releasePointerCapture = () => {};
      patched = true;
    }

    function restoreCapture() {
      if (!patched) return;
      canvas.setPointerCapture = nativeSetCapture;
      canvas.releasePointerCapture = nativeReleaseCapture;
      patched = false;
    }

    function fire(type, x, y, buttons) {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 900001,
          pointerType: 'mouse',
          isPrimary: true,
          button: panButton,
          buttons,
          clientX: x,
          clientY: y,
        }),
      );
    }

    function cancelNative(id) {
      if (id === null) return;
      canvas.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: 'mouse',
          isPrimary: true,
        }),
      );
    }

    function block(event) {
      if (event.pointerType !== 'touch') return;
      if (event.isPrimary === false || multi) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    }

    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((type) => {
      canvas.addEventListener(type, block, true);
    });
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (event.pointerType === 'touch' && event.isPrimary) firstId = event.pointerId;
      },
      true,
    );

    canvas.addEventListener(
      'touchstart',
      (event) => {
        if (event.touches.length !== 2 || walking()) return;
        event.preventDefault();
        if (!multi) {
          multi = true;
          cancelNative(firstId);
          patchCapture();
        }
        const [a, b] = event.touches;
        lastDistance = distance(a, b);
        lastMid = midpoint(a, b);
      },
      { capture: true, passive: false },
    );

    canvas.addEventListener(
      'touchmove',
      (event) => {
        if (!multi || event.touches.length !== 2 || walking()) return;
        event.preventDefault();
        const [a, b] = event.touches;
        const span = distance(a, b);
        const mid = midpoint(a, b);
        if (lastDistance > 0 && span > 0) {
          const scale = span / lastDistance;
          const deltaY = -Math.log(scale) / zoomFactor;
          if (Math.abs(deltaY) > 0.1) {
            counts.pinch += 1;
            canvas.dispatchEvent(
              new WheelEvent('wheel', {
                bubbles: true,
                cancelable: true,
                deltaMode: 0,
                deltaY: clamp(deltaY, -120, 120),
                clientX: mid.x,
                clientY: mid.y,
              }),
            );
          }
        }
        const dx = mid.x - lastMid.x;
        const dy = mid.y - lastMid.y;
        if (!dragging && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
          dragging = true;
          counts.pan += 1;
          fire('pointerdown', lastMid.x, lastMid.y, panButtons);
          fire('pointermove', mid.x, mid.y, panButtons);
        } else if (dragging) {
          fire('pointermove', mid.x, mid.y, panButtons);
        }
        lastDistance = span;
        lastMid = mid;
      },
      { capture: true, passive: false },
    );

    function finish() {
      if (!multi) return;
      if (dragging && lastMid) fire('pointerup', lastMid.x, lastMid.y, 0);
      multi = false;
      dragging = false;
      lastDistance = 0;
      lastMid = null;
      firstId = null;
      restoreCapture();
    }

    canvas.addEventListener('touchend', finish, { capture: true, passive: false });
    canvas.addEventListener('touchcancel', finish, { capture: true, passive: false });
  };

  if (mapPage) {
    if (document.getElementById('map')) attach();
    else document.addEventListener('DOMContentLoaded', attach, { once: true });
  }
})();
