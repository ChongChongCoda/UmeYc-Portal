import { afterEach, describe, expect, it } from 'vitest';
import { getActiveControllerIndex } from './controller';

const host = window as unknown as {
  SteamUIStore?: { ActiveControllerIndex?: number; MostRecentlyActiveControllerIndex?: number };
};

afterEach(() => {
  delete host.SteamUIStore;
});

describe('Steam controller device index', () => {
  it('uses the actual device index even when it is 15', () => {
    host.SteamUIStore = { ActiveControllerIndex: 15, MostRecentlyActiveControllerIndex: 0 };
    expect(getActiveControllerIndex()).toBe(15);
  });

  it('falls back to the most recently active valid device', () => {
    host.SteamUIStore = { ActiveControllerIndex: -1, MostRecentlyActiveControllerIndex: 7 };
    expect(getActiveControllerIndex()).toBe(7);
  });

  it('does not invent a device when Steam has no valid controller', () => {
    expect(getActiveControllerIndex()).toBeUndefined();
    host.SteamUIStore = {
      ActiveControllerIndex: 16,
      MostRecentlyActiveControllerIndex: Number.NaN,
    };
    expect(getActiveControllerIndex()).toBeUndefined();
  });
});
