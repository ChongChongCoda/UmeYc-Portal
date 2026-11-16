import { findModuleExport } from '@decky/ui';
import { callable, toaster } from '@decky/api';
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
const useButtonFeed: ((index: number) => { bRightStickClick?: boolean } | undefined) | undefined =
  findModuleExport(
    (value: unknown) =>
      typeof value === 'function' && value.toString().includes('useControllerButtonFeed'),
  );

const fullscreenWeb = callable<[url: string], void>('toggle_web_fullscreen');

const FullscreenInput = ({ controllerIndex }: { controllerIndex: number }) => {
  const buttons = useButtonFeed!(controllerIndex);
  // A stick already held while enabling/opening must be released first.
  const previous = useRef(true);
  const inFlight = useRef(false);
  const pressed = buttons?.bRightStickClick;
  useEffect(() => {
    if (pressed === undefined) return;
    const trigger = pressed && !previous.current;
    previous.current = pressed;
    const page = webPage();
    if (!trigger || inFlight.current || !page) return;
    inFlight.current = true;
    void fullscreenWeb(page.url)
      .catch((error: unknown) =>
        toaster.toast({ title: '视频全屏快捷键发送失败', body: String(error) }),
      )
      .finally(() => {
        inFlight.current = false;
      });
  }, [pressed]);
  return null;
};

const setMotion = callable<[path: string, x: number, y: number], void>('set_reader_motion');
const scrollWebPage = callable<
  [url: string, x: number, y: number, width: number, height: number],
  void
>('scroll_web_page');
const releaseWebScroll = callable<[], void>('release_web_scroll');

const webPage = () => {
  const view = (
    window as unknown as {
      portal?: { URL: string; GetBrowser(): { GetBounds(): { width: number; height: number } } };
    }
  ).portal;
  return view && { url: view.URL, ...view.GetBrowser().GetBounds() };
};

export const stickVelocity = (value: number): number => {
  if (!Number.isFinite(value) || Math.abs(value) <= 0.18) return 0;
  return Math.sign(value) * Math.min(1, (Math.abs(value) - 0.18) / 0.82);
};

const NativeReaderInput = ({
  path,
  controllerIndex,
}: {
  path?: string;
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
    let reportedError = false;
    const timer = setInterval(() => {
      const x = stickVelocity(latest.current?.RightJoystick?.x ?? 0);
      // Steam reports positive Y upwards; DOM scrollTop grows downwards.
      const y = -stickVelocity(latest.current?.RightJoystick?.y ?? 0);
      if (inFlight || (!x && !y && !moved)) return;
      moved = !!(x || y);
      const page = path ? undefined : webPage();
      if (!path && (!page || (!x && !y))) return;
      inFlight = true;
      const motion = path
        ? setMotion(path, x, y)
        : scrollWebPage(page!.url, x, y, page!.width, page!.height);
      void motion
        .catch((error: unknown) => {
          if (!path && !reportedError) {
            reportedError = true;
            toaster.toast({ title: '网页滚动暂不可用', body: String(error) });
          }
        })
        .finally(() => {
          inFlight = false;
        });
    }, 100);
    return () => {
      clearInterval(timer);
      if (path) void setMotion(path, 0, 0).catch(() => undefined);
      else void releaseWebScroll().catch(() => undefined);
    };
  }, [path, controllerIndex]);

  return null;
};

export const ReaderInput = ({
  path,
  fullscreen = false,
}: {
  path?: string;
  fullscreen?: boolean;
}) => {
  const [controllerIndex, setControllerIndex] = useState(getActiveControllerIndex);
  useEffect(() => {
    const timer = setInterval(() => setControllerIndex(getActiveControllerIndex()), 250);
    return () => clearInterval(timer);
  }, []);

  if (controllerIndex === undefined) return null;
  return (
    <>
      {useAxesFeed && <NativeReaderInput path={path} controllerIndex={controllerIndex} />}
      {!path && fullscreen && useButtonFeed && (
        <FullscreenInput key={controllerIndex} controllerIndex={controllerIndex} />
      )}
    </>
  );
};
