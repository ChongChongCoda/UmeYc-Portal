import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { openFilePicker, prepareLocalFileMock, toaster } from '../__mocks__/decky-api';
import { localPathFromUrl } from '../lib/local-files';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { Settings } from './settings';
import { useGlobalState } from '../hooks/global-state';
import { Position, ViewMode } from '../lib/util';
import { showModal } from '@decky/ui';

vi.mock('../hooks/global-state', () => ({
  useGlobalState: vi.fn(),
}));

vi.mock('./url-modal', () => ({
  UrlModalWithState: () => <div>URL Modal</div>,
}));

vi.mock('@decky/ui', () => ({
  Field: ({ children, label }: { children: ReactNode; label: string }) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
  Focusable: ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
    <div style={style}>{children}</div>
  ),
  DialogButton: ({ children, ...props }: ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
  PanelSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  PanelSectionRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ButtonItem: ({
    label,
    children,
    onClick,
  }: {
    label?: string;
    children?: ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{label ?? children}</button>,
  ToggleField: ({
    label,
    checked,
    disabled,
    description,
    onChange,
  }: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    description?: string;
    onChange: (val: boolean) => void;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {description && <span data-testid="toggle-description">{description}</span>}
    </label>
  ),
  showModal: vi.fn(),
}));

const createState = (viewMode: ViewMode) => ({
  viewMode,
  previousViewMode: ViewMode.Picture,
  visible: true,
  position: Position.TopRight,
  margin: 30,
  size: 1,
  url: 'https://netflix.com',
  controlBar: true,
});

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it.each([ViewMode.Picture, ViewMode.Expand, ViewMode.Minimised, ViewMode.Closed])(
    'opens settings directly in sidebar mode from legacy mode %s',
    (mode) => {
      let state = createState(mode);
      vi.mocked(useGlobalState).mockReturnValue([
        state,
        (updater: (s: typeof state) => typeof state) => {
          state = updater(state);
        },
        {},
      ] as never);
      render(<Settings />);
      expect(state.viewMode).toBe(ViewMode.Sidebar);
      expect(state.visible).toBe(true);
      for (const label of ['布局', '展开', '控制栏', '位置', '大小', '边距']) {
        expect(screen.queryByLabelText(label)).toBeNull();
        expect(screen.queryByText(label)).toBeNull();
      }
    },
  );

  it('offers optional sidebar space control for websites only', () => {
    let state = { ...createState(ViewMode.Sidebar), sidebarVideoSpace: false };
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (f: (s: typeof state) => typeof state) => {
        state = f(state);
      },
      {},
    ] as never);
    const { rerender } = render(<Settings />);
    fireEvent.click(screen.getByLabelText('随侧栏播放/暂停'));
    expect(state.sidebarVideoSpace).toBe(true);
    vi.mocked(useGlobalState).mockReturnValue([
      { ...state, url: 'file:///tmp/guide.JPG' },
      vi.fn(),
      {},
    ] as never);
    rerender(<Settings />);
    expect(screen.queryByLabelText('随侧栏播放/暂停')).toBeNull();
  });

  it('opens an SD-card image and remembers its directory', async () => {
    let state = createState(ViewMode.Picture);
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });
    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);
    const path = '/run/media/deck/SD/明末攻略/第一章 #1.JPG';
    openFilePicker.mockResolvedValueOnce({ realpath: path, path });
    prepareLocalFileMock.mockResolvedValueOnce({ url: 'http://127.0.0.1:1234/viewer/test' });
    render(<Settings />);
    fireEvent.click(screen.getByText('本地文件'));
    await waitFor(() => expect(localPathFromUrl(state.url)).toBe(path));
    expect(openFilePicker.mock.calls[0][1]).toBe('/run/media');
    expect(state.visible).toBe(true);
    expect(state.viewMode).toBe(ViewMode.Sidebar);
    expect(localStorage.getItem('portal.localDirectory')).toBe('/run/media/deck/SD/明末攻略');
  });

  it('restores the page after cancellation without showing an error', async () => {
    let state = createState(ViewMode.Picture);
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (updater: (s: typeof state) => typeof state) => {
        state = updater(state);
      },
      {},
    ] as never);
    openFilePicker.mockRejectedValueOnce('User canceled');
    render(<Settings />);
    fireEvent.click(screen.getByText('本地文件'));
    await waitFor(() => expect(state.visible).toBe(true));
    expect(state.url).toBe('https://netflix.com');
    expect(toaster.toast).not.toHaveBeenCalled();
  });

  it('keeps the previous page when the selected file cannot be read', async () => {
    let state = createState(ViewMode.Picture);
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (updater: (s: typeof state) => typeof state) => {
        state = updater(state);
      },
      {},
    ] as never);
    openFilePicker.mockResolvedValueOnce({ path: '/missing.JPG' });
    prepareLocalFileMock.mockRejectedValueOnce(new Error('文件不存在'));
    render(<Settings />);
    fireEvent.click(screen.getByText('本地文件'));
    await waitFor(() => expect(toaster.toast).toHaveBeenCalled());
    expect(state.url).toBe('https://netflix.com');
    expect(state.visible).toBe(true);
  });

  it('can reopen a closed reader in sidebar mode', () => {
    let state = createState(ViewMode.Closed);
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (updater: (s: typeof state) => typeof state) => {
        state = updater(state);
      },
      {},
    ] as never);
    render(<Settings />);
    expect(state.viewMode).toBe(ViewMode.Sidebar);
    // Model closing the page while the settings panel remains mounted.
    state = createState(ViewMode.Closed);
    fireEvent.click(screen.getByText('打开'));
    expect(state.viewMode).toBe(ViewMode.Sidebar);
  });

  it('handles address modal and close in sidebar mode', () => {
    let state = createState(ViewMode.Picture);
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, { marker: true }] as never);

    render(<Settings />);

    fireEvent.click(screen.getByRole('button', { name: '编辑网址' }));
    expect(showModal).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('关闭'));
    expect(state.viewMode).toBe(ViewMode.Closed);
  });

  it('keeps the complete URL on one line beside an icon-only QR button', () => {
    const state = {
      ...createState(ViewMode.Sidebar),
      url: 'https://example.com/' + 'guide/'.repeat(50),
    };
    vi.mocked(useGlobalState).mockReturnValue([state, vi.fn(), { marker: true }] as never);
    render(<Settings />);
    const edit = screen.getByRole('button', { name: '编辑网址' });
    expect(edit).toHaveTextContent(state.url);
    expect(edit.querySelector('span')).toHaveStyle({
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    });
    const qr = screen.getByRole('button', { name: '扫码输入网址' });
    expect(qr.textContent).toBe('');
    expect(qr.querySelector('svg')).toBeTruthy();
    expect(edit.contains(qr)).toBe(false);
    fireEvent.click(qr);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(state.url).toBe('https://example.com/' + 'guide/'.repeat(50));
  });

  it('shows the Chinese local filename and opens the history picker', () => {
    const state = {
      ...createState(ViewMode.Sidebar),
      url: 'file:///run/media/deck/SD/%E4%B8%AD%E6%96%87%E6%94%BB%E7%95%A5.JPG',
    };
    vi.mocked(useGlobalState).mockReturnValue([state, vi.fn(), {}] as never);
    render(<Settings />);
    expect(screen.getByRole('button', { name: '编辑网址' })).toHaveTextContent('中文攻略.JPG');
    expect(screen.queryByText(state.url)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '浏览历史' }));
    expect(showModal).toHaveBeenCalledOnce();
  });
});
