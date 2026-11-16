import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { zoomWebPageMock, toaster } from '../__mocks__/decky-api';
import { WebHeader } from './web-header';
import icons from '../../assets/zoom-icons.json';

describe('web page header', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the title and the same icon paths used by local images', () => {
    render(
      <WebHeader
        title="攻略视频标题"
        getUrl={() => 'https://guide.example/'}
        x={0}
        y={0}
        width={506}
      />,
    );
    expect(screen.getByText('攻略视频标题')).toHaveStyle({
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    });
    for (const [action, label] of [
      ['smaller', '缩小'],
      ['default', '默认'],
      ['larger', '放大'],
    ] as const) {
      const button = screen.getByRole('button', { name: label });
      expect(button.textContent).toBe('');
      expect(button.querySelector('path')?.getAttribute('d')).toBe(icons[action]);
    }
  });

  it('resolves the current redirected URL on each press and releases the busy state', async () => {
    let url = 'https://guide.example/one';
    render(<WebHeader title="Guide" getUrl={() => url} x={0} y={0} width={506} />);
    for (const [action, label] of [
      ['smaller', '缩小'],
      ['default', '默认'],
      ['larger', '放大'],
    ] as const) {
      url += '/next';
      await act(async () => fireEvent.click(screen.getByRole('button', { name: label })));
      expect(zoomWebPageMock).toHaveBeenLastCalledWith(url, action, 'Guide');
      expect(screen.getByRole('button', { name: label })).toBeEnabled();
    }
  });

  it('prevents duplicate pending actions and recovers from an error', async () => {
    let reject!: (error: Error) => void;
    zoomWebPageMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    render(
      <WebHeader title="Guide" getUrl={() => 'https://guide.example/'} x={0} y={0} width={506} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(screen.getByRole('button', { name: '缩小' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '缩小' }));
    expect(zoomWebPageMock).toHaveBeenCalledOnce();
    await act(async () => reject(new Error('page closed')));
    expect(screen.getByRole('button', { name: '缩小' })).toBeEnabled();
    expect(toaster.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '网页缩放失败' }));
  });
});
