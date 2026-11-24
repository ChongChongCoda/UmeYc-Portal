import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { MapSearchModal } from './map-search-modal';
import { useGlobalState } from '../hooks/global-state';
import {
  getUrlInputStatusMock,
  searchLocalAppMock,
  startUrlInputMock,
} from '../__mocks__/decky-api';

vi.mock('../lib/steam-keyboard', () => ({ getVirtualKeyboardManager: () => undefined }));
vi.mock('../hooks/global-state', () => ({ useGlobalState: vi.fn() }));
vi.mock('@decky/ui', () => ({
  DialogButton: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock('./panel-dialog', () => ({
  PanelDialog: ({
    children,
    onOK,
    strOKButtonText,
  }: {
    children: ReactNode;
    onOK: () => void;
    strOKButtonText: string;
  }) => (
    <div>
      <button onClick={onOK}>{strOKButtonText}</button>
      {children}
    </div>
  ),
}));
vi.mock('./qr-code', () => ({
  QrCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}));

const state = {
  url: 'http://127.0.0.1:8137/app/token/items.html',
  visible: true,
  viewMode: 3,
};

const session = {
  session_id: 'session-1',
  url: 'http://192.168.1.20:51234/token',
  expires_in: 300,
  mode: 'search' as const,
};

describe('map search modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useGlobalState).mockReturnValue([state, vi.fn(), {}] as never);
    startUrlInputMock.mockResolvedValue(session);
    getUrlInputStatusMock.mockResolvedValue({ status: 'expired' });
    searchLocalAppMock.mockReset().mockResolvedValue({ found: true });
  });

  it('starts a phone search session and shows its QR code', async () => {
    getUrlInputStatusMock.mockReturnValue(new Promise(() => undefined));
    render(<MapSearchModal closeModal={vi.fn()} />);
    expect(startUrlInputMock).toHaveBeenCalledWith('', 'search');
    expect(await screen.findByTestId('qr')).toHaveTextContent(session.url);
    expect(screen.getByRole('status')).toHaveTextContent('等待手机发送');
  });

  it('sends phone-entered text to the open atlas page and closes', async () => {
    getUrlInputStatusMock.mockResolvedValue({ status: 'received', kind: 'search', text: ' 三叉戟 ' });
    const close = vi.fn();
    render(<MapSearchModal closeModal={close} />);
    await waitFor(() => expect(searchLocalAppMock).toHaveBeenCalledWith(state.url, '三叉戟'));
    expect(getUrlInputStatusMock).toHaveBeenCalledWith('session-1');
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('shows a backend error without closing when injection fails', async () => {
    searchLocalAppMock.mockRejectedValueOnce(new Error('地图页面尚未打开'));
    getUrlInputStatusMock.mockResolvedValue({ status: 'received', kind: 'search', text: '钥匙' });
    const close = vi.fn();
    render(<MapSearchModal closeModal={close} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('地图页面尚未打开'));
    expect(close).not.toHaveBeenCalled();
  });

  it('reports an expired QR code and does not search', async () => {
    render(<MapSearchModal closeModal={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('二维码已过期'));
    expect(searchLocalAppMock).not.toHaveBeenCalled();
  });

  it('reports a failed QR session start', async () => {
    startUrlInputMock.mockRejectedValueOnce(new Error('请连接 Wi-Fi'));
    render(<MapSearchModal closeModal={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('无法生成二维码'),
    );
  });
});
