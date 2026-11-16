import { findModuleExport } from '@decky/ui';
import { callable } from '@decky/api';
import { useEffect, useRef, useState } from 'react';
import { getActiveControllerIndex } from '../lib/controller';

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

const NativeReaderInput = ({
  path,
  controllerIndex,
}: {
  path: string;
  controllerIndex: number;
}) => {
  const axes = useAxesFeed!(controllerIndex);
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
  }, [path, controllerIndex]);

  return null;
};

export const ReaderInput = ({ path }: { path: string }) => {
  const [controllerIndex, setControllerIndex] = useState(getActiveControllerIndex);
  useEffect(() => {
    const timer = setInterval(() => setControllerIndex(getActiveControllerIndex()), 250);
    return () => clearInterval(timer);
  }, []);

  return useAxesFeed && controllerIndex !== undefined ? (
    <NativeReaderInput path={path} controllerIndex={controllerIndex} />
  ) : null;
};
