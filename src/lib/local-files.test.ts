import { describe, expect, it } from 'vitest';
import { addressLabel, editableAddress, localPathFromUrl, toLocalFileUrl } from './local-files';

describe('local file addresses', () => {
  it('round-trips Chinese names, spaces, percent signs, fragments and query characters', () => {
    const path = '/run/media/deck/SD/明末攻略/上 #1? 100%.JPG';
    const url = toLocalFileUrl(path);
    expect(new window.URL(url).hash).toBe('');
    expect(new window.URL(url).search).toBe('');
    expect(localPathFromUrl(url)).toBe(path);
  });

  it('leaves web URLs alone and accepts absolute local paths', () => {
    expect(localPathFromUrl('https://example.com/guide.jpg')).toBeNull();
    expect(localPathFromUrl('/tmp/guide.jpg')).toBe('/tmp/guide.jpg');
    expect(localPathFromUrl('file://localhost/tmp/guide.jpg')).toBe('/tmp/guide.jpg');
  });

  it('rejects non-local file hosts and relative file paths', () => {
    expect(() => localPathFromUrl('file://remote/tmp/guide.jpg')).toThrow();
    expect(() => toLocalFileUrl('guide.jpg')).toThrow();
  });

  it('shows decoded Chinese filenames and an editable local path', () => {
    const path = '/run/media/deck/SD/明末攻略/第一章 #1 100%.JPG';
    expect(addressLabel(toLocalFileUrl(path))).toBe('第一章 #1 100%.JPG');
    expect(editableAddress(toLocalFileUrl(path))).toBe(path);
    expect(addressLabel(path)).toBe('第一章 #1 100%.JPG');
  });

  it('preserves web addresses and tolerates malformed saved file addresses', () => {
    for (const url of ['https://example.com/a%20b?x=1', 'file:///bad%ZZ']) {
      expect(addressLabel(url)).toBe(url);
      expect(editableAddress(url)).toBe(url);
    }
  });
});
