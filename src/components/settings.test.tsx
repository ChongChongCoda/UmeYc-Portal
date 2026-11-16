import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { openFilePicker, prepareLocalFileMock, toaster } from '../__mocks__/decky-api';
import { localPathFromUrl } from '../lib/local-files';
import type { ReactNode } from 'react';

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

interface DropdownOption {
  data: number;
  label: string;
}

vi.mock('@decky/ui', () => ({
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
  DropdownItem: ({
    label,
    selectedOption,
    rgOptions,
    onMenuOpened,
    onChange,
  }: {
    label: string;
    selectedOption: number;
    rgOptions: DropdownOption[];
    onMenuOpened?: () => void;
    onChange: (option: DropdownOption) => void;
  }) => (
    <div>
      <button onClick={onMenuOpened}>Open {label}</button>
      <select
        aria-label={label}
        value={selectedOption}
        onChange={(e) =>
          onChange(rgOptions.find((o) => o.data === Number(e.target.value)) as DropdownOption)
        }
      >
        {rgOptions.map((option) => (
          <option key={option.data} value={option.data}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  ),
  SliderField: ({
    label,
    value,
    onChange,
    min,
    max,
    step,
  }: {
    label: string;
    value: number;
    onChange: (val: number) => void;
    min: number;
    max: number;
    step: number;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
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

  it('switches to the sidebar reading layout', () => {
    let state = createState(ViewMode.Picture);
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (updater: (s: typeof state) => typeof state) => {
        state = updater(state);
      },
      {},
    ] as never);
    render(<Settings />);
    fireEvent.change(screen.getByLabelText('布局'), {
      target: { value: String(ViewMode.Sidebar) },
    });
    expect(state.viewMode).toBe(ViewMode.Sidebar);
    expect(state.visible).toBe(true);
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
    expect(state.viewMode).toBe(ViewMode.Picture);
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

  it('opens from closed state and can be closed again', () => {
    let state = createState(ViewMode.Closed);
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);

    render(<Settings />);

    fireEvent.click(screen.getByText('打开'));
    expect(state.viewMode).toBe(ViewMode.Picture);
  });

  it('handles address modal, expand toggle and close in open mode', () => {
    let state = createState(ViewMode.Picture);
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, { marker: true }] as never);

    render(<Settings />);

    fireEvent.click(screen.getByText('网址'));
    expect(showModal).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('展开'));
    expect(state.viewMode).toBe(ViewMode.Expand);

    fireEvent.click(screen.getByText('关闭'));
    expect(state.viewMode).toBe(ViewMode.Closed);
  });

  it('preserves minimised state when opening settings', () => {
    let state = createState(ViewMode.Minimised);
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);

    render(<Settings />);

    // The useEffect should make visible but NOT change viewMode from Minimised
    expect(setGlobalState).toHaveBeenCalled();
    const updater = setGlobalState.mock.calls[0][0] as (s: typeof state) => typeof state;
    const result = updater(createState(ViewMode.Minimised));
    expect(result.viewMode).toBe(ViewMode.Minimised);
    expect(result.visible).toBe(true);
  });

  it('auto-restores from closed to picture when opening settings', () => {
    let state = createState(ViewMode.Closed);
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);

    render(<Settings />);

    expect(setGlobalState).toHaveBeenCalled();
    const updater = setGlobalState.mock.calls[0][0] as (s: typeof state) => typeof state;
    const result = updater(createState(ViewMode.Closed));
    expect(result.viewMode).toBe(ViewMode.Picture);
    expect(result.visible).toBe(true);
  });

  it('shows close button when minimised', () => {
    const state = createState(ViewMode.Minimised);
    const setGlobalState = vi.fn();

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);

    render(<Settings />);

    expect(screen.getByText('关闭')).toBeTruthy();
  });

  it('shows pip controls with minimised warning when minimised', () => {
    const state = createState(ViewMode.Minimised);
    const setGlobalState = vi.fn();

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);

    render(<Settings />);

    expect(screen.getByText(/窗口已最小化/)).toBeTruthy();
    expect(screen.getByLabelText('位置')).toBeTruthy();
    expect(screen.getByLabelText('大小')).toBeTruthy();
    expect(screen.getByLabelText('边距')).toBeTruthy();
  });

  it('disables expand toggle when minimised', () => {
    const state = createState(ViewMode.Minimised);
    const setGlobalState = vi.fn();

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);

    render(<Settings />);

    const expandToggle = screen.getByLabelText<HTMLInputElement>('展开');
    expect(expandToggle.disabled).toBe(true);
    expect(screen.getByTestId('toggle-description').textContent).toBe(
      '最小化时无法展开，请先还原窗口',
    );
  });

  it('allows editing pip settings while minimised without changing viewMode', () => {
    let state = createState(ViewMode.Minimised);
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);

    render(<Settings />);

    fireEvent.change(screen.getByLabelText('位置'), {
      target: { value: String(Position.Bottom) },
    });
    expect(state.position).toBe(Position.Bottom);
    expect(state.viewMode).toBe(ViewMode.Minimised);

    fireEvent.change(screen.getByLabelText('大小'), { target: { value: '1.3' } });
    expect(state.size).toBe(1.3);
    expect(state.viewMode).toBe(ViewMode.Minimised);

    fireEvent.change(screen.getByLabelText('边距'), { target: { value: '45' } });
    expect(state.margin).toBe(45);
    expect(state.viewMode).toBe(ViewMode.Minimised);
  });

  it('shows Control Bar toggle in picture mode', () => {
    let state = createState(ViewMode.Picture);
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);

    render(<Settings />);

    const toggle = screen.getByLabelText<HTMLInputElement>('控制栏');
    expect(toggle).toBeTruthy();
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);
    expect(state.controlBar).toBe(false);
  });

  it('hides Control Bar toggle when minimised', () => {
    const state = createState(ViewMode.Minimised);
    const setGlobalState = vi.fn();

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);

    render(<Settings />);

    expect(screen.queryByLabelText('控制栏')).toBeNull();
  });

  it('updates view position and slider values in picture mode', () => {
    let state = createState(ViewMode.Picture);
    const setGlobalState = vi.fn((updater: (s: typeof state) => typeof state) => {
      state = updater(state);
    });

    vi.mocked(useGlobalState).mockReturnValue([state, setGlobalState, {}] as never);

    render(<Settings />);

    fireEvent.click(screen.getByText('Open 位置'));
    expect(state.visible).toBe(false);

    fireEvent.change(screen.getByLabelText('位置'), {
      target: { value: String(Position.Bottom) },
    });
    expect(state.position).toBe(Position.Bottom);
    expect(state.viewMode).toBe(ViewMode.Picture);

    fireEvent.change(screen.getByLabelText('大小'), { target: { value: '1.3' } });
    expect(state.size).toBe(1.3);

    fireEvent.change(screen.getByLabelText('边距'), { target: { value: '45' } });
    expect(state.margin).toBe(45);
  });
});
