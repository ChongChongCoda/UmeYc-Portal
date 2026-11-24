import { callable, toaster } from '@decky/api';
import { UPLOAD_DIRECTORY_KEY } from './phone-input';

export interface OfflineCollection {
  id: string;
  title: string;
  url: string;
  created_at: number;
  pages: number;
  status: string;
  open_token: string;
  delete_token: string;
}

export interface OfflineListing {
  directory: string;
  entries: OfflineCollection[];
}

export interface DeletedOfflineCollection {
  id: string;
  title: string;
  directory: string;
}

export const OFFLINE_AUTO_KEY = 'portal.offlineAuto';

export interface OfflineSaveStatus {
  status: 'running' | 'done' | 'cancelled' | 'error';
  stage: string;
  message: string;
  url: string;
  title: string;
  collection: {
    id: string;
    title: string;
    url: string;
    mode: string;
    resources: number;
    failed: number;
    links: number;
    link_pages?: number;
  } | null;
  started_at: number;
  finished_at: number | null;
}

let captureActive = false;
const CAPTURE_WATCH_LIMIT_MS = 15 * 60 * 1000;

export const isOfflineCaptureActive = (): boolean => captureActive;

/**
 * Keep the portal hidden while the backend navigates through linked pages.
 * The browser has to stay alive for CDP capture, but its URL changes must not
 * leak into history or the visible reader.
 */
export const watchOfflineSave = (): void => {
  if (captureActive) return;
  captureActive = true;
  const deadline = Date.now() + CAPTURE_WATCH_LIMIT_MS;
  let failures = 0;
  const tick = async () => {
    try {
      const status = await getOfflineSaveStatus();
      failures = 0;
      if (!status || status.status !== 'running' || Date.now() > deadline) {
        captureActive = false;
        if (status?.status === 'done') {
          const pages = status.collection?.link_pages;
          toaster.toast({
            title: '离线保存完成',
            body: `${status.collection?.title || '网页'}${
              pages ? `（含 ${pages} 个链接页面）` : ''
            }。断网后请从「本地文件 → 离线网页」打开`,
          });
        } else if (status?.status === 'error') {
          toaster.toast({ title: '离线保存失败', body: status.message });
        } else if (status?.status === 'cancelled') {
          toaster.toast({ title: '已取消离线保存', body: '' });
        }
        return;
      }
    } catch {
      failures += 1;
      if (failures >= 15 || Date.now() > deadline) {
        captureActive = false;
        return;
      }
    }
    setTimeout(() => void tick(), 1000);
  };
  void tick();
};

export const saveOfflinePage = callable<
  [url: string, title: string, directory: string],
  { started: boolean; status: OfflineSaveStatus }
>('save_offline_page');

export const getOfflineSaveStatus = callable<[], OfflineSaveStatus | null>(
  'get_offline_save_status',
);

export const cancelOfflineSave = callable<[], OfflineSaveStatus | null>('cancel_offline_save');

export const listOfflineCollections = callable<[directory: string], OfflineListing>(
  'list_offline_collections',
);

export const openOfflineCollection = callable<[token: string], { url: string }>(
  'open_offline_collection',
);

export const deleteOfflineCollection = callable<[token: string], DeletedOfflineCollection>(
  'delete_offline_collection',
);

const normalizePageUrl = (value: string): string => value.split('#')[0].replace(/\/+$/, '');

export const findOfflineCollection = (
  collections: OfflineCollection[],
  url: string,
): OfflineCollection | null => {
  const target = normalizePageUrl(url);
  return collections.find((entry) => normalizePageUrl(entry.url) === target) ?? null;
};

/**
 * Resolve a web URL to its saved collection without requiring the caller to
 * know the current save directory. Used when the Deck is already offline:
 * re-clicking a web history entry should open the local copy instead of a
 * network error page.
 */
export const findSavedOfflinePage = async (url: string): Promise<OfflineCollection | null> => {
  const listing = await listOfflineCollections(localStorage.getItem(UPLOAD_DIRECTORY_KEY) || '');
  return findOfflineCollection(listing.entries, url);
};

export const offlineStatusLabel = (status: string): string => {
  if (status === 'saved' || status === 'complete') return '已保存';
  if (status === 'partial') return '部分保存';
  if (status === 'empty') return '空';
  return status;
};
