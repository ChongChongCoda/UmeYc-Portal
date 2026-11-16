import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setReaderMotionMock } from '../__mocks__/decky-api';

const { useAxesMock } = vi.hoisted(() => ({ useAxesMock: vi.fn() }));
vi.mock('@decky/ui', () => ({ findModuleExport: () => useAxesMock }));

import { ReaderInput, stickVelocity } from './reader-input';

describe('right stick reader input', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
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
});
