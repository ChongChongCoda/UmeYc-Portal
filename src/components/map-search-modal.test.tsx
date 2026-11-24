import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { MapSearchModal } from './map-search-modal';
import { useGlobalState } from '../hooks/global-state';
import { searchLocalAppMock } from '../__mocks__/decky-api';

vi.mock('../hooks/global-state', () => ({ useGlobalState: vi.fn() }));
vi.mock('@decky/ui', () => ({
  TextField: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (event: { target: { value: string } }) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onChange({ target: { value: event.currentTarget.value } })}
    />
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

const state = {
  url: 'http://127.0.0.1:8137/app/token/items.html',
  visible: true,
  viewMode: 3,
};

describe('map search modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useGlobalState).mockReturnValue([
      state,
      (update: (current: typeof state) => typeof state) => update(state),
      {},
    ] as never);
    searchLocalAppMock.mockReset().mockResolvedValue({ found: true });
  });

  it('submits the query to the open atlas page and closes', async () => {
    const close = vi.fn();
    render(<MapSearchModal closeModal={close} />);
    fireEvent.change(screen.getByLabelText('搜索内容'), {
      target: { value: '三叉戟' },
    });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(searchLocalAppMock).toHaveBeenCalledWith(state.url, '三叉戟'));
    expect(close).toHaveBeenCalledOnce();
  });

  it('shows the backend error without closing', async () => {
    searchLocalAppMock.mockRejectedValueOnce(new Error('地图页面尚未打开'));
    const close = vi.fn();
    render(<MapSearchModal closeModal={close} />);
    fireEvent.change(screen.getByLabelText('搜索内容'), { target: { value: '钥匙' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('地图页面尚未打开'));
    expect(close).not.toHaveBeenCalled();
  });
});
