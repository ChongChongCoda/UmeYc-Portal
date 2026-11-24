import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { LocalFilesModal } from './local-files-modal';
import { useGlobalState } from '../hooks/global-state';
import {
  cancelOfflineSaveMock,
  cancelStorageMigrationMock,
  deleteLocalFileMock,
  deleteOfflineCollectionMock,
  getOfflineSaveStatusMock,
  getStorageMigrationStatusMock,
  listLocalFilesMock,
  listOfflineCollectionsMock,
  openOfflineCollectionMock,
  planStorageMigrationMock,
  startStorageMigrationMock,
  getUploadDirectoryMock,
  prepareLocalFileMock,
} from '../__mocks__/decky-api';
import { getUrlHistory, rememberUrl } from '../lib/url-history';
import { toLocalFileUrl } from '../lib/local-files';
import { ViewMode } from '../lib/util';

vi.mock('../hooks/global-state', () => ({ useGlobalState: vi.fn() }));
vi.mock('@decky/ui', () => ({
  DialogButton: (props: ComponentProps<'button'>) => <button {...props} />,
  Focusable: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('./panel-dialog', () => ({
  PanelDialog: ({
    children,
    onOK,
    onCancel,
    strOKButtonText,
    bAlertDialog,
  }: {
    children: ReactNode;
    onOK: () => void;
    onCancel: () => void;
    strOKButtonText: string;
    bAlertDialog: boolean;
  }) => (
    <div>
      <button onClick={onOK}>{strOKButtonText}</button>
      {!bAlertDialog && <button onClick={onCancel}>取消</button>}
      {children}
    </div>
  ),
}));

vi.mock('./folder-picker', () => ({
  FolderPicker: ({ onChoose }: { onChoose(path: string): void }) => (
    <button onClick={() => onChoose('/home/deck/Pictures')}>use folder</button>
  ),
}));

const path = '/run/media/deck/SD/攻略/第一章.JPG';
const offlineDirectory = '/run/media/deck/SD/攻略/offline';
const collection = {
  id: '20261124-101530-abc123',
  title: '女王魔域攻略合集',
  url: 'https://www.xiaoheihe.cn/app/bbs/link/196297922',
  created_at: 1763945730,
  pages: 13,
  status: 'saved',
  open_token: 'open-grant',
  delete_token: 'delete-grant',
};
const listing = {
  directory: '/run/media/deck/SD/攻略',
  parent: '/run/media/deck/SD',
  entries: [
    { name: '第一章.JPG', path, directory: false, delete_token: 'grant' },
    { name: '第二章', path: '/run/media/deck/SD/攻略/第二章', directory: true, delete_token: null },
  ],
  truncated: false,
};
const migratedPath = '/home/deck/Pictures/第一章.JPG';
const migrationPlan = {
  old: listing.directory,
  new: '/home/deck/Pictures',
  images: 1,
  collections: 1,
  total: 2,
  bytes: 1024,
  conflicts: 0,
  same_device: true,
};
const migrationRunning = {
  status: 'running',
  old: listing.directory,
  new: '/home/deck/Pictures',
  current: '第一章.JPG',
  total_items: 2,
  done_items: 0,
  bytes_total: 1024,
  bytes_done: 0,
  errors: [],
  images: [],
  collections: [],
  started_at: 1763945730,
  finished_at: null,
};
const migrationDone = {
  ...migrationRunning,
  status: 'done',
  done_items: 2,
  bytes_done: 1024,
  current: '',
  images: [{ from: path, to: migratedPath }],
  collections: [
    {
      from: '20261124-101530-abc123',
      to: '20261124-101530-abc123',
      title: '女王魔域攻略合集',
      directory: '/home/deck/Pictures/offline/20261124-101530-abc123',
    },
  ],
  finished_at: 1763945740,
};

describe('local file management', () => {
  let state: { url: string; visible: boolean; viewMode: ViewMode };
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    state = { url: toLocalFileUrl(path), visible: true, viewMode: ViewMode.Sidebar };
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (update: (s: typeof state) => typeof state) => {
        state = update(state);
      },
    ] as never);
    listLocalFilesMock.mockReset().mockResolvedValue(listing);
    getUploadDirectoryMock.mockReset().mockResolvedValue({ directory: listing.directory });
    deleteLocalFileMock.mockReset().mockResolvedValue({ path });
    prepareLocalFileMock.mockReset().mockResolvedValue({ url: 'http://127.0.0.1/viewer/test' });
    listOfflineCollectionsMock.mockReset().mockResolvedValue({
      directory: offlineDirectory,
      entries: [],
    });
    openOfflineCollectionMock
      .mockReset()
      .mockResolvedValue({ url: 'http://127.0.0.1:9911/open-grant/index.html' });
    deleteOfflineCollectionMock.mockReset().mockResolvedValue({
      id: collection.id,
      title: collection.title,
      directory: offlineDirectory,
    });
    planStorageMigrationMock.mockReset().mockResolvedValue({
      old: listing.directory,
      new: '/home/deck/Pictures',
      images: 0,
      collections: 0,
      total: 0,
      bytes: 0,
      conflicts: 0,
      same_device: true,
    });
    startStorageMigrationMock.mockReset();
    getStorageMigrationStatusMock.mockReset().mockResolvedValue(null);
    cancelStorageMigrationMock.mockReset().mockResolvedValue(null);
    getOfflineSaveStatusMock.mockReset().mockResolvedValue(null);
    cancelOfflineSaveMock.mockReset().mockResolvedValue(null);
  });

  it('opens a Chinese SD-card image after validation and restores visibility', async () => {
    const close = vi.fn();
    const { unmount } = render(<LocalFilesModal closeModal={close} />);
    expect(state.visible).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: '打开文件 第一章.JPG' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(prepareLocalFileMock).toHaveBeenCalledWith(path);
    expect(state.url).toBe(toLocalFileUrl(path));
    expect(state.visible).toBe(true);
    expect(localStorage.getItem('portal.localDirectory')).toBe(listing.directory);
    unmount();
  });

  it('requires confirmation to delete and clears the matching history and current reader', async () => {
    rememberUrl(localStorage, 'https://keep.example/');
    rememberUrl(localStorage, path);
    const close = vi.fn();
    render(<LocalFilesModal closeModal={close} />);
    fireEvent.click(await screen.findByRole('button', { name: '删除文件 第一章.JPG' }));
    expect(deleteLocalFileMock).not.toHaveBeenCalled();
    expect(screen.getByText(/删除后无法恢复/)).toBeTruthy();
    fireEvent.click(screen.getByText('取消'));
    expect(deleteLocalFileMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '删除文件 第一章.JPG' }));
    fireEvent.click(screen.getByRole('button', { name: /^删除文件$/ }));
    await waitFor(() => expect(listLocalFilesMock).toHaveBeenCalledTimes(2));
    expect(deleteLocalFileMock).toHaveBeenCalledExactlyOnceWith('grant');
    expect(getUrlHistory(localStorage)).toEqual(['https://keep.example/']);
    expect(state.url).toBe('');
    expect(state.viewMode).toBe(ViewMode.Closed);
    expect(close).not.toHaveBeenCalled();
  });

  it('keeps the page and history when opening or deleting fails', async () => {
    rememberUrl(localStorage, path);
    prepareLocalFileMock.mockRejectedValueOnce(new Error('文件不存在'));
    deleteLocalFileMock.mockRejectedValueOnce(new Error('文件已变化'));
    render(<LocalFilesModal closeModal={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '打开文件 第一章.JPG' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('文件不存在'));
    fireEvent.click(screen.getByRole('button', { name: '删除文件 第一章.JPG' }));
    fireEvent.click(screen.getByRole('button', { name: /^删除文件$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('文件已变化'));
    expect(state.url).toBe(toLocalFileUrl(path));
    expect(getUrlHistory(localStorage)).toEqual([toLocalFileUrl(path)]);
  });

  it('navigates folders and chooses a folder in the same left panel', async () => {
    render(<LocalFilesModal closeModal={vi.fn()} />);
    await screen.findByRole('button', { name: '打开文件夹 第二章' });
    fireEvent.click(screen.getByText('选择文件夹'));
    fireEvent.click(screen.getByText('use folder'));
    await waitFor(() => expect(listLocalFilesMock).toHaveBeenLastCalledWith('/home/deck/Pictures'));
    fireEvent.click(await screen.findByRole('button', { name: '打开文件夹 第二章' }));
    await waitFor(() =>
      expect(listLocalFilesMock).toHaveBeenLastCalledWith('/run/media/deck/SD/攻略/第二章'),
    );
  });

  it('ignores a file open that finishes after closing', async () => {
    let finish!: (value: unknown) => void;
    prepareLocalFileMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const close = vi.fn();
    const { unmount } = render(<LocalFilesModal closeModal={close} />);
    fireEvent.click(await screen.findByRole('button', { name: '打开文件 第一章.JPG' }));
    unmount();
    await act(async () => finish({ url: 'http://127.0.0.1/viewer/test' }));
    expect(close).not.toHaveBeenCalled();
    expect(state.visible).toBe(true);
  });

  it('opens a saved offline collection in the reader', async () => {
    listOfflineCollectionsMock.mockResolvedValue({
      directory: offlineDirectory,
      entries: [collection],
    });
    const close = vi.fn();
    render(<LocalFilesModal closeModal={close} />);
    fireEvent.click(await screen.findByRole('button', { name: '打开离线网页 女王魔域攻略合集' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(openOfflineCollectionMock).toHaveBeenCalledWith('open-grant');
    expect(state.url).toBe('http://127.0.0.1:9911/open-grant/index.html');
    expect(state.visible).toBe(true);
    expect(state.viewMode).toBe(ViewMode.Sidebar);
  });

  it('deletes an offline collection with all pages only after confirmation', async () => {
    listOfflineCollectionsMock.mockResolvedValue({
      directory: offlineDirectory,
      entries: [collection],
    });
    render(<LocalFilesModal closeModal={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '删除离线网页 女王魔域攻略合集' }));
    expect(deleteOfflineCollectionMock).not.toHaveBeenCalled();
    expect(screen.getByText(/包含的页面和图片会一起删除/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^删除网页$/ }));
    await waitFor(() =>
      expect(deleteOfflineCollectionMock).toHaveBeenCalledExactlyOnceWith('delete-grant'),
    );
    await waitFor(() => expect(listOfflineCollectionsMock).toHaveBeenCalledTimes(2));
  });

  it('migrates images and offline collections when the save location changes', async () => {
    getUploadDirectoryMock.mockImplementation(async (directory: string) => ({
      directory: directory || listing.directory,
    }));
    listLocalFilesMock.mockImplementation(async (directory: string) => ({
      ...listing,
      directory,
    }));
    rememberUrl(localStorage, toLocalFileUrl(path));
    planStorageMigrationMock.mockResolvedValue(migrationPlan);
    startStorageMigrationMock.mockResolvedValue({
      started: true,
      plan: migrationPlan,
      status: migrationRunning,
    });
    getStorageMigrationStatusMock.mockResolvedValue(migrationDone);
    render(<LocalFilesModal closeModal={vi.fn()} />);
    const change = await screen.findByRole('button', { name: '更换' });
    await waitFor(() => expect(change).not.toBeDisabled());
    fireEvent.click(change);
    fireEvent.click(screen.getByText('use folder'));
    fireEvent.click(await screen.findByRole('button', { name: '迁移并更换' }));
    await waitFor(() =>
      expect(localStorage.getItem('portal.uploadDirectory')).toBe('/home/deck/Pictures'),
    );
    expect(planStorageMigrationMock).toHaveBeenCalledWith(listing.directory, '/home/deck/Pictures');
    expect(startStorageMigrationMock).toHaveBeenCalledWith(
      listing.directory,
      '/home/deck/Pictures',
    );
    await waitFor(() =>
      expect(getUrlHistory(localStorage)).toEqual([toLocalFileUrl(migratedPath)]),
    );
    expect(state.url).toBe(toLocalFileUrl(migratedPath));
    expect(localStorage.getItem('portal.localDirectory')).toBe('/home/deck/Pictures');
  });

  it('changes the save location without moving files when the user keeps them', async () => {
    planStorageMigrationMock.mockResolvedValue(migrationPlan);
    render(<LocalFilesModal closeModal={vi.fn()} />);
    const change = await screen.findByRole('button', { name: '更换' });
    await waitFor(() => expect(change).not.toBeDisabled());
    fireEvent.click(change);
    fireEvent.click(screen.getByText('use folder'));
    fireEvent.click(await screen.findByRole('button', { name: '仅更换' }));
    expect(localStorage.getItem('portal.uploadDirectory')).toBe('/home/deck/Pictures');
    expect(startStorageMigrationMock).not.toHaveBeenCalled();
  });

  it('shows and cancels a running offline save', async () => {
    getOfflineSaveStatusMock.mockResolvedValue({
      status: 'running',
      stage: 'snapshot',
      message: '保存页面快照',
      url: 'https://example.com/guide',
      title: '攻略页面',
      collection: null,
      started_at: 1763945730,
      finished_at: null,
    });
    const { unmount } = render(<LocalFilesModal closeModal={vi.fn()} />);
    expect(await screen.findByText(/正在离线保存/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消保存' }));
    await waitFor(() => expect(cancelOfflineSaveMock).toHaveBeenCalledOnce());
    unmount();
  });

  it('refreshes collections when an offline save finishes', async () => {
    getOfflineSaveStatusMock.mockResolvedValue({
      status: 'done',
      stage: 'done',
      message: '离线保存完成',
      url: 'https://example.com/guide',
      title: '攻略页面',
      collection: {
        id: '20261124-101530-abc123',
        title: '攻略页面',
        url: 'https://example.com/guide',
        mode: 'html',
        resources: 4,
        failed: 0,
        links: 2,
      },
      started_at: 1763945730,
      finished_at: 1763945740,
    });
    render(<LocalFilesModal closeModal={vi.fn()} />);
    await waitFor(() => expect(listOfflineCollectionsMock.mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByText(/已保存离线网页/)).toBeTruthy();
  });
});
