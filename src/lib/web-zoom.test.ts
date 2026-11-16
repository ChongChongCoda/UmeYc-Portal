import source from '../../assets/web-zoom.js?raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const key = Symbol.for('umeyc.portal.pageZoom');
const root = document.documentElement as typeof document.documentElement & {
  [key: symbol]: unknown;
};
const zoom = (action: 'smaller' | 'default' | 'larger'): { factor: number } =>
  window.eval(source.replace('__PORTAL_ZOOM_ACTION__', JSON.stringify(action)));

describe('web page layout zoom', () => {
  beforeEach(() => {
    root.style.removeProperty('zoom');
    delete root[key];
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    vi.stubGlobal('visualViewport', { scale: 1 });
  });
  afterEach(() => {
    root.style.removeProperty('zoom');
    delete root[key];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shrinks below the original size, enlarges back and restores the original style', () => {
    root.style.setProperty('zoom', '1.1', 'important');
    expect(zoom('smaller').factor).toBeCloseTo(1 / 1.2);
    expect(parseFloat(root.style.zoom)).toBeCloseTo(1.1 / 1.2);
    expect(zoom('larger').factor).toBeCloseTo(1);
    zoom('larger');
    expect(zoom('default').factor).toBe(1);
    expect(root.style.getPropertyValue('zoom')).toBe('1.1');
    expect(root.style.getPropertyPriority('zoom')).toBe('important');
  });

  it('bounds repeated presses and resets without leaving an inline zoom behind', () => {
    for (let i = 0; i < 20; ++i) zoom('smaller');
    expect(zoom('smaller').factor).toBe(0.25);
    for (let i = 0; i < 40; ++i) zoom('larger');
    expect(zoom('larger').factor).toBe(3);
    zoom('default');
    expect(root.style.getPropertyValue('zoom')).toBe('');
  });

  it('accounts for existing native pinch when changing layout zoom', () => {
    vi.stubGlobal('visualViewport', { scale: 2 });
    expect(zoom('smaller').factor).toBeCloseTo(2 / 1.2);
    expect(zoom('default').factor).toBe(1);
  });
});
