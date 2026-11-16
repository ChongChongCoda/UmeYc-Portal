import { describe, expect, it } from 'vitest';
import {
  getUrlHistory,
  rememberUrl,
  URL_HISTORY_KEY,
  URL_HISTORY_TITLES_KEY,
  rememberPageTitle,
  historyLabel,
} from './url-history';
import { toLocalFileUrl } from './local-files';

describe('twenty-item browsing history', () => {
  it('keeps only the twenty most recent addresses, newest first', () => {
    for (let i = 0; i < 23; i++) rememberUrl(localStorage, `https://example.com/${i}`);
    expect(getUrlHistory(localStorage)).toEqual(
      Array.from({ length: 20 }, (_, i) => 22 - i).map((i) => `https://example.com/${i}`),
    );
  });

  it('moves a repeated address to the front instead of duplicating it', () => {
    for (const url of ['https://a.example/', 'https://b.example/', 'https://a.example/'])
      rememberUrl(localStorage, url);
    expect(getUrlHistory(localStorage)).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('deduplicates Bilibili tracking URLs while preserving different videos and parts', () => {
    rememberUrl(localStorage, 'https://www.bilibili.com/video/BV123/?share=first&p=1');
    rememberPageTitle(localStorage, 'https://www.bilibili.com/video/BV123/?p=1', '第一集');
    rememberUrl(localStorage, 'https://www.bilibili.com/video/BV456/?trackid=next');
    rememberUrl(localStorage, 'https://www.bilibili.com/video/BV123?trackid=return');
    expect(getUrlHistory(localStorage)).toEqual([
      'https://www.bilibili.com/video/BV123/',
      'https://www.bilibili.com/video/BV456/',
    ]);
    expect(historyLabel(localStorage, 'https://www.bilibili.com/video/BV123?p=1')).toBe('第一集');
    rememberUrl(localStorage, 'https://www.bilibili.com/video/BV123/?p=2');
    expect(getUrlHistory(localStorage)[0]).toBe('https://www.bilibili.com/video/BV123/?p=2');
  });

  it('migrates existing tracked Bilibili titles and duplicate URLs', () => {
    const first = 'https://www.bilibili.com/video/BV123/?p=1&share=first';
    const second = 'https://www.bilibili.com/video/BV123/?share=second';
    localStorage.setItem(URL_HISTORY_KEY, JSON.stringify([first, second]));
    localStorage.setItem(URL_HISTORY_TITLES_KEY, JSON.stringify({ [first]: '标题' }));
    expect(getUrlHistory(localStorage)).toEqual(['https://www.bilibili.com/video/BV123/']);
    expect(historyLabel(localStorage, second)).toBe('标题');
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
  it('labels webpages by title while keeping the original address and recency', () => {
    rememberUrl(localStorage, 'https://b23.tv/short');
    rememberUrl(localStorage, 'https://example.com/other');
    const before = getUrlHistory(localStorage);
    rememberPageTitle(localStorage, 'https://b23.tv/short', '  中文视频\n标题  ');
    expect(historyLabel(localStorage, 'https://b23.tv/short')).toBe('中文视频 标题');
    expect(getUrlHistory(localStorage)).toEqual(before);
    rememberPageTitle(localStorage, 'https://b23.tv/short', '');
    expect(historyLabel(localStorage, 'https://b23.tv/short')).toBe('中文视频 标题');
    expect(historyLabel(localStorage, 'https://example.com/other')).toBe('未命名网页');
  });

  it('migrates old URL-only history on reopen and prunes titles of evicted entries', () => {
    localStorage.setItem(URL_HISTORY_KEY, JSON.stringify(['https://old.example/']));
    rememberPageTitle(localStorage, 'https://old.example/', '旧记录标题');
    rememberUrl(localStorage, 'https://old.example/');
    expect(historyLabel(localStorage, 'https://old.example/')).toBe('旧记录标题');
    for (let i = 0; i < 20; i++) rememberUrl(localStorage, `https://example.com/${i}`);
    expect(localStorage.getItem(URL_HISTORY_TITLES_KEY)).not.toContain('旧记录标题');
    rememberPageTitle(localStorage, 'https://old.example/', '迟到的标题');
    expect(localStorage.getItem(URL_HISTORY_TITLES_KEY)).not.toContain('迟到');
  });

  it('ignores corrupt title storage and always labels local files by filename', () => {
    const url = toLocalFileUrl('/tmp/中文图片.JPG');
    rememberUrl(localStorage, url);
    localStorage.setItem(URL_HISTORY_TITLES_KEY, '{');
    expect(historyLabel(localStorage, url)).toBe('中文图片.JPG');
    localStorage.setItem(URL_HISTORY_TITLES_KEY, JSON.stringify({ [url]: '错误标题' }));
    rememberPageTitle(localStorage, url, '网页标题');
    expect(historyLabel(localStorage, url)).toBe('中文图片.JPG');
  });
});
