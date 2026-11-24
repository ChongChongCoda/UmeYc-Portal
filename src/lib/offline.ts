import { callable } from '@decky/api';

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
  } | null;
  started_at: number;
  finished_at: number | null;
}

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

export const offlineStatusLabel = (status: string): string => {
  if (status === 'saved' || status === 'complete') return '已保存';
  if (status === 'partial') return '部分保存';
  if (status === 'empty') return '空';
  return status;
};
