import { localPathFromUrl, toLocalFileUrl } from './local-files';

export const URL_HISTORY_KEY = 'portal.urlHistory';

interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const historyAddress = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value || value.length > 8192) return null;
  try {
    const path = localPathFromUrl(value);
    if (path) return toLocalFileUrl(path);
    const parsed = new window.URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname ? value : null;
  } catch {
    return null;
  }
};

export const getUrlHistory = (storage: HistoryStorage): string[] => {
  try {
    const values: unknown = JSON.parse(storage.getItem(URL_HISTORY_KEY) || '[]');
    if (!Array.isArray(values)) return [];
    return [
      ...new Set(values.map(historyAddress).filter((value): value is string => value !== null)),
    ].slice(0, 5);
  } catch {
    return [];
  }
};

export const rememberUrl = (storage: HistoryStorage, value: string) => {
  const address = historyAddress(value);
  if (!address) return;
  const recent = getUrlHistory(storage);
  try {
    storage.setItem(
      URL_HISTORY_KEY,
      JSON.stringify([address, ...recent.filter((url) => url !== address)].slice(0, 5)),
    );
  } catch {
    // A full/unavailable history store must never prevent opening a page.
  }
};
