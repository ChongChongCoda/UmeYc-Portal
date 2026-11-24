import { callable } from '@decky/api';

export const LOCAL_APP_DIRECTORY_KEY = 'portal.localAppDirectory';
export const LOCAL_APP_ENTRY_KEY = 'portal.localAppEntry';

export interface LocalAppInfo {
  directory: string;
  entries: string[];
}

export interface OpenedLocalApp extends LocalAppInfo {
  url: string;
}

export const LOCAL_APP_PAGES = [
  { entry: 'index.html', label: '2D 地图' },
  { entry: 'world.html', label: '3D 地图' },
  { entry: 'items.html', label: '物品查询' },
] as const;

export const validateLocalApp = callable<[directory: string], LocalAppInfo>('validate_local_app');

export const openLocalApp = callable<[directory: string, entry: string], OpenedLocalApp>(
  'open_local_app',
);

// Local preview, offline collection and local-app URLs all use loopback. They
// contain session tokens and must never be persisted as page history.
export const isLoopbackUrl = (url: string): boolean =>
  /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//i.test(url);
