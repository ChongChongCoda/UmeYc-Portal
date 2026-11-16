import { callable } from '@decky/api';

export const LOCAL_FILE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'ico',
  'pdf',
  'html',
  'htm',
  'txt',
  'md',
];

export const LOCAL_DIRECTORY_KEY = 'portal.localDirectory';

export const prepareLocalFile = callable<[path: string], { url: string }>('prepare_local_file');

export const toLocalFileUrl = (path: string): string => {
  if (!path.startsWith('/')) throw new Error('请选择本地文件的绝对路径');
  return 'file://' + path.split('/').map(encodeURIComponent).join('/');
};

export const localPathFromUrl = (address: string): string | null => {
  if (address.startsWith('/')) return address;
  if (!address.startsWith('file:')) return null;
  const url = new window.URL(address);
  if (url.hostname && url.hostname !== 'localhost') throw new Error('仅支持本机文件');
  return decodeURIComponent(url.pathname);
};

export const localPickerDirectory = (address: string): string => {
  const path = localPathFromUrl(address);
  return path
    ? path.slice(0, path.lastIndexOf('/')) || '/'
    : localStorage.getItem(LOCAL_DIRECTORY_KEY) || '/run/media';
};

export const addressLabel = (address: string): string => {
  try {
    const path = localPathFromUrl(address);
    return path ? path.slice(path.lastIndexOf('/') + 1) || path : address;
  } catch {
    return address;
  }
};

export const editableAddress = (address: string): string => {
  try {
    return localPathFromUrl(address) ?? address;
  } catch {
    return address;
  }
};
