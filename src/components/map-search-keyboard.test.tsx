import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { MapSearchModal } from './map-search-modal';
import { useGlobalState } from '../hooks/global-state';
import {
  getUrlInputStatusMock,
  searchLocalAppMock,
  startUrlInputMock,
} from '../__mocks__/decky-api';

const mocks = vi.hoisted(() => {
  const ref = {
    ShowVirtualKeyboard: vi.fn(),
    SetAsCurrentVirtualKeyboardTarget: vi.fn(),
    HideVirtualKeyboard: vi.fn(),
    BIsActive: vi.fn(() => true),
  };
  const manager = {
    CreateVirtualKeyboardRef: vi.fn((_options?: unknown) => ref),
  };
  return { ref, manager };
});

vi.mock('../lib/steam-keyboard', () => ({
  getVirtualKeyboardManager: () => mocks.manager,
}));
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
    bOKDisabled,
  }: {
    children: ReactNode;
    onOK?: () => void;
    strOKButtonText: string;
    bOKDisabled?: boolean;
  }) => (
    <div>
      <button onClick={onOK} disabled={bOKDisabled}>
        {strOKButtonText}
      </button>
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

type KeyboardOptions = {
  strEnterKeyLabel?: string;
  onTextEntered: (text: string) => void;
  onEnterKeyPress: () => string | null | undefined;
};

const lastOptions = (): KeyboardOptions => {
  const calls = mocks.manager.CreateVirtualKeyboardRef.mock.calls;
  return calls[calls.length - 1][0] as unknown as KeyboardOptions;
};

describe('map search with the Steam keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ref.BIsActive.mockReturnValue(true);
    vi.mocked(useGlobalState).mockReturnValue([state, vi.fn(), {}] as never);
    searchLocalAppMock.mockReset().mockResolvedValue({ found: true });
    startUrlInputMock.mockResolvedValue({
      session_id: 'phone-session',
      url: 'http://192.168.1.20:51234/token',
      expires_in: 300,
      mode: 'search',
    });
    getUrlInputStatusMock.mockReturnValue(new Promise(() => undefined));
  });

  it('opens the Steam keyboard and shows committed IME text in a top strip', () => {
    render(<MapSearchModal closeModal={vi.fn()} />);
    expect(mocks.ref.SetAsCurrentVirtualKeyboardTarget).toHaveBeenCalledOnce();
    expect(mocks.ref.ShowVirtualKeyboard).toHaveBeenCalledOnce();
    expect(lastOptions().strEnterKeyLabel).toBe('搜索');
    expect(screen.getByText('请使用屏幕键盘输入关键词')).toBeInTheDocument();

    act(() => lastOptions().onTextEntered('钥匙'));
    expect(screen.getByText('钥匙')).toBeInTheDocument();
    const cancel = screen.getByRole('button', { name: '取消搜索' });
    expect(cancel).toHaveStyle({ width: '72px' });
  });

  it('submits committed candidate text when the keyboard search key is pressed', async () => {
    const close = vi.fn();
    render(<MapSearchModal closeModal={close} />);
    act(() => {
      lastOptions().onTextEntered('三');
      lastOptions().onTextEntered('叉戟');
    });
    let result: string | null | undefined;
    await act(async () => {
      result = lastOptions().onEnterKeyPress();
    });
    expect(result).toBeNull();
    expect(mocks.ref.HideVirtualKeyboard).toHaveBeenCalled();
    await waitFor(() => expect(searchLocalAppMock).toHaveBeenCalledWith(state.url, '三叉戟'));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('handles Backspace and ignores navigation keys', () => {
    render(<MapSearchModal closeModal={vi.fn()} />);
    act(() => {
      lastOptions().onTextEntered('钥匙知识');
      lastOptions().onTextEntered('ArrowLeft');
      lastOptions().onTextEntered('Backspace');
    });
    expect(screen.getByText('钥匙知')).toBeInTheDocument();
  });

  it('does not submit an empty query', async () => {
    const close = vi.fn();
    render(<MapSearchModal closeModal={close} />);
    let result: string | null | undefined;
    await act(async () => {
      result = lastOptions().onEnterKeyPress();
    });
    expect(result).toBeNull();
    expect(searchLocalAppMock).not.toHaveBeenCalled();
    expect(mocks.ref.HideVirtualKeyboard).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('returns to the dialog with the text when injection fails', async () => {
    searchLocalAppMock.mockRejectedValueOnce(new Error('地图页面尚未打开'));
    const close = vi.fn();
    render(<MapSearchModal closeModal={close} />);
    act(() => lastOptions().onTextEntered('钥匙'));
    await act(async () => {
      lastOptions().onEnterKeyPress();
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('地图页面尚未打开'));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByText('钥匙')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续输入' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '改用手机扫码输入' }),
    ).toBeInTheDocument();
  });

  it('can reopen the keyboard after it is dismissed', async () => {
    mocks.ref.BIsActive.mockReturnValue(false);
    render(<MapSearchModal closeModal={vi.fn()} />);
    await waitFor(
      () => expect(screen.getByRole('button', { name: '继续输入' })).toBeInTheDocument(),
      { timeout: 2000 },
    );
    mocks.ref.BIsActive.mockReturnValue(true);
    act(() => fireEvent.click(screen.getByRole('button', { name: '继续输入' })));
    await waitFor(() => expect(mocks.ref.ShowVirtualKeyboard).toHaveBeenCalledTimes(2));
  });

  it('switches to the phone form when Steam keyboard input is unusable', async () => {
    searchLocalAppMock.mockRejectedValueOnce(new Error('injection failed'));
    render(<MapSearchModal closeModal={vi.fn()} />);
    act(() => lastOptions().onTextEntered('钥匙'));
    await act(async () => {
      lastOptions().onEnterKeyPress();
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '改用手机扫码输入' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: '改用手机扫码输入' }));
    await waitFor(() => expect(startUrlInputMock).toHaveBeenCalledWith('', 'search'));
  });
});
