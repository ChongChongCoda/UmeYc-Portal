import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  releaseWebScrollMock,
  scrollWebPageMock,
  setReaderMotionMock,
} from '../__mocks__/decky-api';
import { getActiveControllerIndex } from '../lib/controller';

const { useAxesMock } = vi.hoisted(() => ({ useAxesMock: vi.fn() }));
vi.mock('@decky/ui', () => ({ findModuleExport: () => useAxesMock }));
vi.mock('../lib/controller', () => ({ getActiveControllerIndex: vi.fn() }));

import { ReaderInput, stickVelocity } from './reader-input';

describe('right stick reader input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(getActiveControllerIndex).mockReturnValue(15);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('has a dead zone and bounded proportional velocity', () => {
    expect(stickVelocity(0.1)).toBe(0);
    expect(stickVelocity(Number.NaN)).toBe(0);
    expect(stickVelocity(1)).toBe(1);
    expect(stickVelocity(-2)).toBe(-1);
    expect(stickVelocity(0.59)).toBeCloseTo(0.5);
  });

  it('sends downward motion, stops on release and unregisters polling when hidden', async () => {
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: -1 } });
    const { rerender, unmount } = render(<ReaderInput path="/tmp/guide.JPG" />);
    expect(useAxesMock).toHaveBeenCalledWith(15);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(setReaderMotionMock).toHaveBeenLastCalledWith('/tmp/guide.JPG', 0, 1);
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: 0 } });
    rerender(<ReaderInput path="/tmp/guide.JPG" />);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(setReaderMotionMock).toHaveBeenLastCalledWith('/tmp/guide.JPG', 0, -0);
    unmount();
    expect(setReaderMotionMock).toHaveBeenLastCalledWith('/tmp/guide.JPG', 0, 0);
    const calls = setReaderMotionMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(setReaderMotionMock).toHaveBeenCalledTimes(calls);
  });

  it('does not send idle motion repeatedly', async () => {
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0.01, y: 0 } });
    const { unmount } = render(<ReaderInput path="/tmp/guide.JPG" />);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(setReaderMotionMock).not.toHaveBeenCalled();
    unmount();
  });

  it('scrolls the current web page and releases it when hidden', async () => {
    Object.assign(window, {
      portal: {
        URL: 'https://guide.example/chapter',
        GetBrowser: () => ({ GetBounds: () => ({ width: 506, height: 534 }) }),
      },
    });
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: -1 } });
    const { rerender, unmount } = render(<ReaderInput />);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(scrollWebPageMock).toHaveBeenLastCalledWith(
      'https://guide.example/chapter',
      0,
      1,
      506,
      534,
    );
    expect(setReaderMotionMock).not.toHaveBeenCalled();
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: 0 } });
    rerender(<ReaderInput />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(scrollWebPageMock).toHaveBeenCalledTimes(1);
    unmount();
    expect(releaseWebScrollMock).toHaveBeenCalledOnce();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(scrollWebPageMock).toHaveBeenCalledTimes(1);
  });

  it('switches the raw feed when Steam changes its active controller', async () => {
    useAxesMock.mockReturnValue({ RightJoystick: { x: 0, y: 0 } });
    const { unmount } = render(<ReaderInput path="/tmp/guide.JPG" />);
    expect(useAxesMock).toHaveBeenLastCalledWith(15);
    vi.mocked(getActiveControllerIndex).mockReturnValue(3);
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(useAxesMock).toHaveBeenLastCalledWith(3);
    unmount();
  });

  it('does not subscribe to a made-up device when no controller exists', () => {
    vi.mocked(getActiveControllerIndex).mockReturnValue(undefined);
    const { unmount } = render(<ReaderInput path="/tmp/guide.JPG" />);
    expect(useAxesMock).not.toHaveBeenCalled();
    unmount();
  });
});
