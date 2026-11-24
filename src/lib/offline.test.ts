import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getOfflineSaveStatusMock } from '../__mocks__/decky-api';
import { isOfflineCaptureActive, watchOfflineSave } from './offline';

describe('offline capture watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getOfflineSaveStatusMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the reader hidden while the save job runs', async () => {
    getOfflineSaveStatusMock
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'done' });
    watchOfflineSave();
    expect(isOfflineCaptureActive()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(isOfflineCaptureActive()).toBe(false);
  });

  it('stops watching after repeated status failures', async () => {
    getOfflineSaveStatusMock.mockRejectedValue(new Error('backend down'));
    watchOfflineSave();
    expect(isOfflineCaptureActive()).toBe(true);
    for (let index = 0; index < 16; index += 1) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(isOfflineCaptureActive()).toBe(false);
  });
});
