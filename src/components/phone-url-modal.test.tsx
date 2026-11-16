import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';

import { PhoneUrlModal } from './phone-url-modal';
import { useGlobalState } from '../hooks/global-state';
import {
  startUrlInputMock,
  getUrlInputStatusMock,
  cancelUrlInputMock,
} from '../__mocks__/decky-api';

vi.mock('../hooks/global-state', () => ({ useGlobalState: vi.fn() }));
vi.mock('@decky/ui', () => ({
  ConfirmModal: ({ children, onOK }: { children: ReactNode; onOK: () => void }) => (
    <div>
      <button onClick={onOK}>关闭</button>
      {children}
    </div>
  ),
  DialogButton: (props: ComponentProps<'button'>) => <button {...props} />,
}));

const session = { session_id: 'one', url: 'http://192.168.1.10:1234/one', expires_in: 300 };
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('QR URL input modal', () => {
  let state: { url: string; visible: boolean };

  beforeEach(() => {
    vi.useFakeTimers();
    state = { url: 'file:///guide.JPG', visible: true };
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (updater: (s: typeof state) => typeof state) => {
        state = updater(state);
      },
    ] as never);
    startUrlInputMock.mockReset().mockResolvedValue(session);
    getUrlInputStatusMock.mockReset().mockResolvedValue({ status: 'waiting' });
    cancelUrlInputMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a locally generated QR code and cancels its session on close', async () => {
    const { unmount } = render(<PhoneUrlModal closeModal={vi.fn()} />);
    expect(state.visible).toBe(false);
    await flush();
    const qr = screen.getByRole('img', { name: '扫码输入网址二维码' });
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
    unmount();
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
    expect(screen.getByRole('alert')).toHaveTextContent('接收网址失败');
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
});
