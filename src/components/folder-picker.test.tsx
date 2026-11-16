import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { FolderPicker } from './folder-picker';
import { listLocalFilesMock } from '../__mocks__/decky-api';

vi.mock('@decky/ui', () => ({
  DialogButton: (props: ComponentProps<'button'>) => <button {...props} />,
  Focusable: ({ children, ...props }: { children: ReactNode } & ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  ),
}));

describe('left panel folder picker', () => {
  beforeEach(() => {
    listLocalFilesMock.mockReset();
  });
  it('shows the actual path, hides files and selects a navigated folder', async () => {
    listLocalFilesMock.mockImplementation(async (directory: string) => ({
      directory,
      parent: '/run/media',
      entries:
        directory === '/run/media'
          ? [
              { name: 'SD', path: '/run/media/SD', directory: true },
              { name: '图片.png', path: '/run/media/图片.png', directory: false },
            ]
          : [],
      truncated: false,
    }));
    const choose = vi.fn(),
      cancel = vi.fn();
    render(<FolderPicker initial="/run/media" onChoose={choose} onCancel={cancel} />);
    expect(screen.getByText('使用此文件夹')).toBeDisabled();
    fireEvent.click(await screen.findByText('SD'));
    await waitFor(() => expect(screen.getByText('/run/media/SD')).toBeTruthy());
    expect(screen.queryByText('图片.png')).toBeNull();
    fireEvent.click(screen.getByText('使用此文件夹'));
    expect(choose).toHaveBeenCalledExactlyOnceWith('/run/media/SD');
    fireEvent.click(screen.getByText('取消'));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('blocks using a folder while loading or after failure and ignores stale responses', async () => {
    let finish!: (value: unknown) => void;
    listLocalFilesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    listLocalFilesMock.mockRejectedValueOnce(new Error('SD 卡不可用'));
    render(<FolderPicker initial="/run/media/old" onChoose={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('SD 卡'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('SD 卡不可用'));
    await act(async () => finish({ directory: '/old', parent: '/', entries: [] }));
    expect(screen.queryByText('/old')).toBeNull();
    expect(screen.getByText('使用此文件夹')).toBeDisabled();
  });
});
