import { callable } from '@decky/api';

export interface StorageMigrationPlan {
  old: string;
  new: string;
  images: number;
  collections: number;
  total: number;
  bytes: number;
  conflicts: number;
  same_device: boolean;
}

export interface StorageMigrationStatus {
  status: 'running' | 'done' | 'cancelled' | 'failed';
  old: string;
  new: string;
  current: string;
  total_items: number;
  done_items: number;
  bytes_total: number;
  bytes_done: number;
  errors: { path: string; message: string }[];
  images: { from: string; to: string }[];
  collections: { from: string; to: string; title: string; directory: string }[];
  started_at: number;
  finished_at: number | null;
}

export const planStorageMigration = callable<[old: string, newPath: string], StorageMigrationPlan>(
  'plan_storage_migration',
);

export const startStorageMigration = callable<
  [old: string, newPath: string],
  { started: boolean; plan: StorageMigrationPlan; status: StorageMigrationStatus | null }
>('start_storage_migration');

export const getStorageMigrationStatus = callable<[], StorageMigrationStatus | null>(
  'get_storage_migration_status',
);

export const cancelStorageMigration = callable<[], StorageMigrationStatus | null>(
  'cancel_storage_migration',
);

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

// Offline collections are served from the same loopback host as local file
// previews, but only collection routes use the bare token path.
export const isOfflineCollectionUrl = (url: string): boolean =>
  /^http:\/\/127\.0\.0\.1:\d+\//.test(url) && !/\/(viewer|file|script|events|state)\//.test(url);
