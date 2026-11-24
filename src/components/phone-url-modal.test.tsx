import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';

import { PhoneUrlModal } from './phone-url-modal';
import { useGlobalState } from '../hooks/global-state';
import { ViewMode } from '../lib/util';
import {
  startUrlInputMock,
  getUrlInputStatusMock,
  cancelUrlInputMock,
  planStorageMigrationMock,
  saveOfflinePageMock,
  startStorageMigrationMock,
} from '../__mocks__/decky-api';

vi.mock('../hooks/global-state', () => ({ useGlobalState: vi.fn() }));
vi.mock('@decky/ui', () => ({
  DialogButton: (props: ComponentProps<'button'>) => <button {...props} />,
}));

vi.mock('./panel-dialog', () => ({
  PanelDialog: ({ children, onOK }: { children: ReactNode; onOK: () => void }) => (
    <div>
      <button onClick={onOK}>关闭</button>
      {children}
    </div>
  ),
}));

vi.mock('./folder-picker', () => ({
  FolderPicker: ({ onChoose }: { onChoose(path: string): void }) => (
    <button onClick={() => onChoose('/run/media/deck/SD/攻略')}>use folder</button>
  ),
}));

const session = { session_id: 'one', url: 'http://192.168.1.10:1234/one', expires_in: 300 };
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('QR URL input modal', () => {
  let state: { url: string; visible: boolean; viewMode: ViewMode };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    state = { url: 'file:///guide.JPG', visible: true, viewMode: ViewMode.Closed };
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (updater: (s: typeof state) => typeof state) => {
        state = updater(state);
      },
    ] as never);
    startUrlInputMock.mockReset().mockResolvedValue(session);
    getUrlInputStatusMock.mockReset().mockResolvedValue({ status: 'waiting' });
    cancelUrlInputMock.mockReset().mockResolvedValue(undefined);
    planStorageMigrationMock.mockReset().mockResolvedValue({
      old: '/run/media/deck/SD/攻略',
      new: '/run/media/deck/SD/攻略',
      images: 0,
      collections: 0,
      total: 0,
      bytes: 0,
      conflicts: 0,
      same_device: true,
    });
    startStorageMigrationMock.mockReset().mockResolvedValue({
      started: true,
      plan: {
        old: '/run/media/deck/SD/攻略',
        new: '/run/media/deck/SD/攻略',
        images: 0,
        collections: 0,
        total: 0,
        bytes: 0,
        conflicts: 0,
        same_device: true,
      },
      status: null,
    });
    saveOfflinePageMock.mockReset().mockResolvedValue({ started: true, status: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a locally generated QR code and cancels its session on close', async () => {
    const { unmount } = render(<PhoneUrlModal closeModal={vi.fn()} />);
    expect(state.visible).toBe(false);
    await flush();
    const qr = screen.getByRole('img', { name: '扫码传送二维码' });
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M/);
    expect(getUrlInputStatusMock).toHaveBeenCalledWith('one');
    unmount();
    expect(cancelUrlInputMock).toHaveBeenCalledWith('one');
    expect(state.visible).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(getUrlInputStatusMock).toHaveBeenCalledTimes(1);
  });

  it('opens the received URL and closes the modal', async () => {
    const close = vi.fn();
    getUrlInputStatusMock
      .mockResolvedValueOnce({ status: 'waiting' })
      .mockResolvedValueOnce({ status: 'received', url: 'https://example.com/guide' });
    const { unmount } = render(<PhoneUrlModal closeModal={close} />);
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(state.url).toBe('https://example.com/guide');
    expect(state.visible).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(saveOfflinePageMock).toHaveBeenCalledWith('https://example.com/guide', '', '');
    unmount();
  });

  it('does not auto-save when offline saving is disabled', async () => {
    localStorage.setItem('portal.offlineAuto', 'off');
    getUrlInputStatusMock.mockResolvedValueOnce({
      status: 'received',
      url: 'https://example.com/guide',
    });
    render(<PhoneUrlModal closeModal={vi.fn()} />);
    await flush();
    expect(state.url).toBe('https://example.com/guide');
    expect(saveOfflinePageMock).not.toHaveBeenCalled();
  });

  it('does not navigate when a pending response arrives after cancellation', async () => {
    let resolve!: (result: unknown) => void;
    getUrlInputStatusMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const close = vi.fn();
    const { unmount } = render(<PhoneUrlModal closeModal={close} />);
    await flush();
    unmount();
    await act(async () => {
      resolve({ status: 'received', url: 'https://late.example' });
    });
    expect(state.url).toBe('file:///guide.JPG');
    expect(close).not.toHaveBeenCalled();
  });

  it('cancels a late-created session after unmount', async () => {
    let resolve!: (result: typeof session) => void;
    startUrlInputMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { unmount } = render(<PhoneUrlModal closeModal={vi.fn()} />);
    unmount();
    await act(async () => {
      resolve(session);
    });
    expect(cancelUrlInputMock).toHaveBeenCalledWith('one');
    expect(getUrlInputStatusMock).not.toHaveBeenCalled();
  });

  it('refreshes an expired session and keeps the original URL', async () => {
    getUrlInputStatusMock.mockResolvedValueOnce({ status: 'expired' });
    startUrlInputMock.mockResolvedValueOnce(session).mockResolvedValueOnce({
      ...session,
      session_id: 'two',
      url: 'http://192.168.1.10:1234/two',
    });
    const { unmount } = render(<PhoneUrlModal closeModal={vi.fn()} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('二维码已过期');
    fireEvent.click(screen.getByText('刷新二维码'));
    await flush();
    expect(startUrlInputMock).toHaveBeenCalledTimes(2);
    expect(cancelUrlInputMock).toHaveBeenCalledWith('one');
    expect(getUrlInputStatusMock).toHaveBeenLastCalledWith('two');
    expect(screen.getByRole('img')).toBeTruthy();
    expect(state.url).toBe('file:///guide.JPG');
    unmount();
  });

  it('reports network setup failure and allows retry', async () => {
    startUrlInputMock.mockRejectedValueOnce(new Error('请连接 Wi-Fi'));
    const { unmount } = render(<PhoneUrlModal closeModal={vi.fn()} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('请连接 Wi-Fi');
    fireEvent.click(screen.getByText('刷新二维码'));
    await flush();
    expect(screen.getByRole('img')).toBeTruthy();
    unmount();
  });

  it('reports polling failure and cancels the listener', async () => {
    getUrlInputStatusMock.mockRejectedValueOnce(new Error('断开连接'));
    const { unmount } = render(<PhoneUrlModal closeModal={vi.fn()} />);
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('接收内容失败');
    expect(cancelUrlInputMock).toHaveBeenCalledWith('one');
    unmount();
  });

  it('closes when the close button is pressed', async () => {
    const close = vi.fn();
    const { unmount } = render(<PhoneUrlModal closeModal={close} />);
    await flush();
    fireEvent.click(screen.getByText('关闭'));
    expect(close).toHaveBeenCalledOnce();
    unmount();
  });

  it('remembers a selected save folder and can restore automatic SD preference', async () => {
    const { unmount } = render(<PhoneUrlModal closeModal={vi.fn()} />);
    await flush();
    expect(startUrlInputMock).toHaveBeenCalledWith('');
    fireEvent.click(screen.getByRole('button', { name: '选择图片保存位置' }));
    await flush();
    fireEvent.click(screen.getByText('use folder'));
    await flush();
    expect(startUrlInputMock).toHaveBeenLastCalledWith('/run/media/deck/SD/攻略');
    expect(localStorage.getItem('portal.uploadDirectory')).toBe('/run/media/deck/SD/攻略');
    fireEvent.click(screen.getByText('恢复自动选择（优先 SD 卡）'));
    await flush();
    expect(startUrlInputMock).toHaveBeenLastCalledWith('');
    expect(localStorage.getItem('portal.uploadDirectory')).toBeNull();
    unmount();
  });

  it('offers migration when the previous save folder still has content', async () => {
    localStorage.setItem('portal.uploadDirectory', '/run/media/deck/SD/旧攻略');
    planStorageMigrationMock.mockResolvedValue({
      old: '/run/media/deck/SD/旧攻略',
      new: '/run/media/deck/SD/攻略',
      images: 2,
      collections: 1,
      total: 3,
      bytes: 2048,
      conflicts: 0,
      same_device: true,
    });
    const { unmount } = render(<PhoneUrlModal closeModal={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '选择图片保存位置' }));
    await flush();
    fireEvent.click(screen.getByText('use folder'));
    await flush();
    await flush();
    expect(screen.getByText(/原保存位置有 2 张图片/)).toBeTruthy();
    fireEvent.click(screen.getByText('仅更换位置'));
    await flush();
    expect(localStorage.getItem('portal.uploadDirectory')).toBe('/run/media/deck/SD/攻略');
    unmount();
  });

  it('keeps polling during upload and opens a received Chinese local file', async () => {
    const url = 'file:///run/media/deck/SD/%E6%94%BB%E7%95%A5.png';
    getUrlInputStatusMock
      .mockResolvedValueOnce({ status: 'uploading' })
      .mockResolvedValueOnce({ status: 'received', url });
    const close = vi.fn();
    const { unmount } = render(<PhoneUrlModal closeModal={close} />);
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('正在接收图片');
    expect(screen.getByRole('button', { name: '选择图片保存位置' })).toBeDisabled();
    expect(cancelUrlInputMock).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(state.url).toBe(url);
    expect(state.viewMode).toBe(ViewMode.Sidebar);
    expect(close).toHaveBeenCalledOnce();
    expect(saveOfflinePageMock).not.toHaveBeenCalled();
    unmount();
  });
});
