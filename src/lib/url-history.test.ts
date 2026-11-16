import { describe, expect, it } from 'vitest';
import { getUrlHistory, rememberUrl, URL_HISTORY_KEY } from './url-history';
import { toLocalFileUrl } from './local-files';

describe('five-item browsing history', () => {
  it('keeps only the five most recent addresses, newest first', () => {
    for (let i = 0; i < 7; i++) rememberUrl(localStorage, `https://example.com/${i}`);
    expect(getUrlHistory(localStorage)).toEqual(
      [6, 5, 4, 3, 2].map((i) => `https://example.com/${i}`),
    );
  });

  it('moves a repeated address to the front instead of duplicating it', () => {
    for (const url of ['https://a.example/', 'https://b.example/', 'https://a.example/'])
      rememberUrl(localStorage, url);
    expect(getUrlHistory(localStorage)).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('remembers local images and canonicalizes encoded versus plain paths', () => {
    const path = '/run/media/deck/SD/中文攻略.JPG';
    rememberUrl(localStorage, toLocalFileUrl(path));
    rememberUrl(localStorage, path);
    expect(getUrlHistory(localStorage)).toEqual([toLocalFileUrl(path)]);
  });

  it('handles malformed storage and rejects unsafe address types', () => {
    for (const value of ['{', '{}']) {
      localStorage.setItem(URL_HISTORY_KEY, value);
      expect(getUrlHistory(localStorage)).toEqual([]);
    }
    localStorage.setItem(
      URL_HISTORY_KEY,
      JSON.stringify([
        null,
        1,
        'javascript:alert(1)',
        'file://remote/x',
        'https://valid.example/',
        'https://valid.example/',
      ]),
    );
    expect(getUrlHistory(localStorage)).toEqual(['https://valid.example/']);
    rememberUrl(localStorage, 'data:text/plain,test');
    expect(getUrlHistory(localStorage)).toEqual(['https://valid.example/']);
  });

  it('does not prevent navigation when history storage is unavailable', () => {
    const unavailable = {
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(getUrlHistory(unavailable)).toEqual([]);
    expect(() => rememberUrl(unavailable, 'https://example.com/')).not.toThrow();
  });
});
