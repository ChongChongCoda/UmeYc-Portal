import { callable } from '@decky/api';

export interface PluginUpdateResult {
  status: 'latest' | 'downloaded' | 'ready';
  current: string;
  version?: string;
  path?: string;
  size?: number;
  replaced?: boolean;
}

export const checkPluginUpdate = callable<[], PluginUpdateResult>('check_plugin_update');

export const UPDATE_CHECK_AT_KEY = 'portal.updateCheckedAt';
export const UPDATE_READY_KEY = 'portal.updateReady';
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface PendingUpdate {
  version: string;
  path: string;
}
