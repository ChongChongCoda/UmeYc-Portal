import { callable } from '@decky/api';

export interface PluginUpdateResult {
  status: 'latest' | 'downloaded' | 'ready' | 'error';
  current?: string;
  version?: string;
  path?: string;
  size?: number;
  replaced?: boolean;
  message?: string;
  detail?: string;
  report?: string;
}

export const checkPluginUpdate = callable<[], PluginUpdateResult>('check_plugin_update');

export const UPDATE_CHECK_AT_KEY = 'portal.updateCheckedAt';
export const UPDATE_READY_KEY = 'portal.updateReady';
export const UPDATE_ERROR_KEY = 'portal.updateError';
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface PendingUpdate {
  version: string;
  path: string;
}
