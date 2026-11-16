import { addressLabel, localPathFromUrl, toLocalFileUrl } from './local-files';

export const URL_HISTORY_KEY = 'portal.urlHistory';
export const URL_HISTORY_TITLES_KEY = 'portal.urlHistoryTitles';

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
    const next = [address, ...recent.filter((url) => url !== address)].slice(0, 5);
    storage.setItem(URL_HISTORY_KEY, JSON.stringify(next));
    const titles = getHistoryTitles(storage);
    storage.setItem(
      URL_HISTORY_TITLES_KEY,
      JSON.stringify(
        Object.fromEntries(next.filter((url) => titles[url]).map((url) => [url, titles[url]])),
      ),
    );
  } catch {
    // A full/unavailable history store must never prevent opening a page.
  }
};

const cleanTitle = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 512) : '';

const getHistoryTitles = (storage: HistoryStorage): Record<string, string> => {
  try {
    const values: unknown = JSON.parse(storage.getItem(URL_HISTORY_TITLES_KEY) || '{}');
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    const recent = getUrlHistory(storage);
    return Object.fromEntries(
      Object.entries(values)
        .filter(
          ([url, title]) => recent.includes(url) && /^https?:\/\//i.test(url) && cleanTitle(title),
        )
        .map(([url, title]) => [url, cleanTitle(title)]),
    );
  } catch {
    return {};
  }
};

// Updating metadata never changes the five-item history order or saved address.
export const rememberPageTitle = (storage: HistoryStorage, url: string, title: string) => {
  const address = historyAddress(url);
  const text = cleanTitle(title);
  if (
    !address ||
    !/^https?:\/\//i.test(address) ||
    !text ||
    !getUrlHistory(storage).includes(address)
  )
    return;
  const titles = getHistoryTitles(storage);
  if (titles[address] === text) return;
  try {
    storage.setItem(URL_HISTORY_TITLES_KEY, JSON.stringify({ ...titles, [address]: text }));
  } catch {
    // Missing metadata must never prevent navigation.
  }
};

export const historyLabel = (storage: HistoryStorage, url: string): string => {
  if (!url) return '未选择网页';
  if (localPathFromUrl(url)) return addressLabel(url);
  return getHistoryTitles(storage)[url] || '未命名网页';
};

export const removeUrl = (storage: HistoryStorage, url: string): boolean => {
  try {
    storage.setItem(
      URL_HISTORY_KEY,
      JSON.stringify(getUrlHistory(storage).filter((item) => item !== url)),
    );
  } catch {
    return false;
  }
  try {
    storage.setItem(URL_HISTORY_TITLES_KEY, JSON.stringify(getHistoryTitles(storage)));
  } catch {
    // Labels are filtered against the remaining history even if metadata storage is full.
  }
  return true;
};
