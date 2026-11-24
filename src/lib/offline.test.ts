import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getOfflineSaveStatusMock,
  listOfflineCollectionsMock,
  toaster,
} from '../__mocks__/decky-api';
import { UPLOAD_DIRECTORY_KEY } from './phone-input';
import {
  findOfflineCollection,
  findSavedOfflinePage,
  isOfflineCaptureActive,
  offlineStatusLabel,
  watchOfflineSave,
  type OfflineCollection,
} from './offline';

const collection = (url: string): OfflineCollection => ({
  id: 'collection-1',
  title: '攻略',
  url,
  created_at: 1,
  pages: 1,
  status: 'saved',
  open_token: 'open',
  delete_token: 'delete',
});

describe('offline collection lookup', () => {
  it('matches a saved page despite trailing slash or fragment differences', () => {
    const entries = [collection('https://www.xiaoheihe.cn/app/bbs/link/123')];
    for (const url of [
      'https://www.xiaoheihe.cn/app/bbs/link/123',
      'https://www.xiaoheihe.cn/app/bbs/link/123/',
      'https://www.xiaoheihe.cn/app/bbs/link/123#top',
    ]) {
      expect(findOfflineCollection(entries, url)?.open_token).toBe('open');
    }
  });

  it('returns nothing without saved collections', () => {
    expect(findOfflineCollection([], 'https://example.com/')).toBeNull();
  });

  it('does not substitute a different page', () => {
    const entries = [collection('https://www.xiaoheihe.cn/app/bbs/link/123')];
    expect(findOfflineCollection(entries, 'https://www.xiaoheihe.cn/app/bbs/link/124')).toBeNull();
    expect(
      findOfflineCollection(entries, 'https://www.xiaoheihe.cn/app/bbs/link/123?p=2'),
    ).toBeNull();
  });

  it('loads the listing from the configured save directory', async () => {
    localStorage.setItem(UPLOAD_DIRECTORY_KEY, '/run/media/deck/SD/攻略');
    listOfflineCollectionsMock.mockResolvedValue({
      directory: '/run/media/deck/SD/攻略',
      entries: [collection('https://www.xiaoheihe.cn/app/bbs/link/123')],
    });
    const found = await findSavedOfflinePage('https://www.xiaoheihe.cn/app/bbs/link/123');
    expect(found?.open_token).toBe('open');
    expect(listOfflineCollectionsMock).toHaveBeenCalledWith('/run/media/deck/SD/攻略');
  });

  it('uses the default save directory when none is configured', async () => {
    localStorage.removeItem(UPLOAD_DIRECTORY_KEY);
    listOfflineCollectionsMock.mockResolvedValue({ directory: '', entries: [] });
    await expect(findSavedOfflinePage('https://x.example/')).resolves.toBeNull();
    expect(listOfflineCollectionsMock).toHaveBeenCalledWith('');
  });

  it('labels every collection state', () => {
    expect(offlineStatusLabel('saved')).toBe('已保存');
    expect(offlineStatusLabel('complete')).toBe('已保存');
    expect(offlineStatusLabel('partial')).toBe('部分保存');
    expect(offlineStatusLabel('empty')).toBe('空');
    expect(offlineStatusLabel('weird')).toBe('weird');
  });
});

describe('offline capture watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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

  it('reports the collection and its linked page count when done', async () => {
    getOfflineSaveStatusMock
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'done', collection: { title: '攻略', link_pages: 2 } });
    watchOfflineSave();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(toaster.toast).toHaveBeenCalledWith({
      title: '离线保存完成',
      body: '攻略（含 2 个链接页面）。断网后请从「本地文件 → 离线网页」打开',
    });
  });

  it('reports failures and cancellation', async () => {
    getOfflineSaveStatusMock
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'error', message: '快照失败' })
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    watchOfflineSave();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    watchOfflineSave();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(toaster.toast).toHaveBeenNthCalledWith(1, {
      title: '离线保存失败',
      body: '快照失败',
    });
    expect(toaster.toast).toHaveBeenNthCalledWith(2, {
      title: '已取消离线保存',
      body: '',
    });
  });

  it('stops quietly when no save job exists', async () => {
    getOfflineSaveStatusMock.mockResolvedValue(null);
    watchOfflineSave();
    await vi.advanceTimersByTimeAsync(0);
    expect(isOfflineCaptureActive()).toBe(false);
    expect(toaster.toast).not.toHaveBeenCalled();
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
