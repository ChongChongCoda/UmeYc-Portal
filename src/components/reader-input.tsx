import { findModuleExport } from '@decky/ui';
import { callable } from '@decky/api';
import { useEffect, useRef } from 'react';

interface AxesState {
  RightJoystick?: { x: number; y: number };
}

// Steam starts/stops its native raw controller feed inside this hook.
const useAxesFeed: ((index: number) => AxesState | undefined) | undefined = findModuleExport(
  (value: unknown) =>
    typeof value === 'function' && value.toString().includes('useControllerAxesFeed'),
);

const setMotion = callable<[path: string, x: number, y: number], void>('set_reader_motion');

export const stickVelocity = (value: number): number => {
  if (!Number.isFinite(value) || Math.abs(value) <= 0.18) return 0;
  return Math.sign(value) * Math.min(1, (Math.abs(value) - 0.18) / 0.82);
};

const NativeReaderInput = ({ path }: { path: string }) => {
  const axes = useAxesFeed!(0);
  const latest = useRef(axes);
  useEffect(() => {
    latest.current = axes;
  }, [axes]);

  useEffect(() => {
    let moved = false;
    let inFlight = false;
    const timer = setInterval(() => {
      const x = stickVelocity(latest.current?.RightJoystick?.x ?? 0);
      // Steam reports positive Y upwards; DOM scrollTop grows downwards.
      const y = -stickVelocity(latest.current?.RightJoystick?.y ?? 0);
      if (inFlight || (!x && !y && !moved)) return;
      moved = !!(x || y);
      inFlight = true;
      void setMotion(path, x, y)
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    }, 100);
    return () => {
      clearInterval(timer);
      void setMotion(path, 0, 0).catch(() => undefined);
    };
  }, [path]);

  return null;
};

export const ReaderInput = ({ path }: { path: string }) =>
  useAxesFeed ? <NativeReaderInput path={path} /> : null;
