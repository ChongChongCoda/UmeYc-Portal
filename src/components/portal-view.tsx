import { Router, WindowRouter, getGamepadNavigationTrees, quickAccessMenuClasses } from '@decky/ui';
import { useEffect, useRef, useState } from 'react';
import { callable, toaster } from '@decky/api';

import { useGlobalState } from '../hooks/global-state';
import { intersectRectangles } from '../lib/geometry';
import { UIComposition, useUIComposition } from '../hooks/use-ui-composition';
import { localPathFromUrl, prepareLocalFile } from '../lib/local-files';
import { getOpenSideMenu, isVirtualKeyboardShowing } from '../lib/menu-state';
import { ReaderInput } from './reader-input';
import { WebHeader, WEB_HEADER_HEIGHT } from './web-header';
import { rememberPageTitle } from '../lib/url-history';
import { UrlModal } from './url-modal';
import { PhoneUrlModal } from './phone-url-modal';
import { UrlHistoryModal } from './url-history-modal';
import { LocalFilesModal } from './local-files-modal';
import { SCREEN_HEIGHT, SCREEN_WIDTH, ViewMode } from '../lib/util';

interface BrowserProps {
  url: string;
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  preserveHiddenBounds?: boolean;
  sidebarOpen?: boolean;
  playbackSpace?: boolean;
  suppressPlayback?: boolean;
  pageTitle?: string;
}

interface BrowserHandle {
  SetVisible(visible: boolean): void;
  SetBounds(x: number, y: number, width: number, height: number): void;
}

interface BrowserViewHandle {
  GetBrowser(): BrowserHandle;
  LoadURL(url: string): void;
  Destroy(): void;
  URL?: string;
  Title?: string;
  BIsLoadingURL?(): boolean;
  StartRequestCallbacks?: { Register(callback: () => void): { Unregister(): void } };
  FinishedRequestCallbacks?: { Register(callback: () => void): { Unregister(): void } };
}

interface MainWindowInstance {
  CreateBrowserView(name: string): BrowserViewHandle;
}

interface NavTree {
  id?: string;
  m_ID?: string;
  Root?: { Element?: { ownerDocument?: { defaultView?: DeckWindow | null } } };
  m_Root?: {
    m_element?: {
      ownerDocument?: {
        defaultView?: DeckWindow | null;
      };
    };
  };
}

interface DeckWindow {
  document: {
    hidden: boolean;
    querySelector?: (selector: string) => {
      getBoundingClientRect(): { width: number };
      getAttribute?(name: string): string | null;
    } | null;
    querySelectorAll?: (
      selector: string,
    ) => ArrayLike<{ getBoundingClientRect(): { width: number } }>;
  };
  screenLeft?: number;
  screenTop?: number;
  outerWidth?: number;
  outerHeight?: number;
}

const sendWebSpace = callable<[url: string], void>('send_web_space');

const Browser = ({
  url,
  visible,
  x,
  y,
  width,
  height,
  preserveHiddenBounds,
  sidebarOpen,
  playbackSpace,
  suppressPlayback,
  pageTitle,
}: BrowserProps) => {
  useUIComposition(UIComposition.Notification);
  const [, , stateContext] = useGlobalState();
  const web = /^https?:\/\//i.test(url);

  const [handles] = useState<{ browser: BrowserHandle; view: BrowserViewHandle } | null>(() => {
    const root = Router.WindowStore?.GamepadUIMainWindowInstance as
      | (WindowRouter & MainWindowInstance)
      | undefined;
    if (!root) {
      return null;
    }

    const view = root.CreateBrowserView('portal');
    const browser = view.GetBrowser();

    (window as unknown as { portal?: BrowserViewHandle }).portal = view;

    return {
      view,
      browser,
    };
  });

  const [titleReadyFor, setTitleReadyFor] = useState<string | null>(null);
  useEffect(() => {
    if (!web || !handles) return;
    let active = true;
    const start = handles.view.StartRequestCallbacks?.Register(() => {
      if (active) setTitleReadyFor(null);
    });
    const finish = handles.view.FinishedRequestCallbacks?.Register(() => {
      if (active && !handles.view.BIsLoadingURL?.()) setTitleReadyFor(url);
    });
    return () => {
      active = false;
      start?.Unregister();
      finish?.Unregister();
    };
  }, [url, handles, web]);

  useEffect(() => {
    if (titleReadyFor === url && handles && !handles.view.BIsLoadingURL?.()) {
      const title = (handles.view.Title || pageTitle || '').trim();
      rememberPageTitle(localStorage, url, title);
      // Share only a completed page's title; the address remains the navigation key.
      const current = stateContext?.get();
      if (
        title &&
        current?.url === url &&
        (current.pageTitle !== title || current.pageTitleUrl !== url)
      ) {
        stateContext.set({ ...current, pageTitle: title, pageTitleUrl: url });
      }
    }
  }, [url, handles, pageTitle, titleReadyFor, stateContext]);

  const previousPlayback = useRef({ url, sidebarOpen, playbackSpace });
  useEffect(() => {
    if (suppressPlayback) {
      handles?.browser.SetVisible(visible);
      return;
    }
    const previous = previousPlayback.current;
    if (!handles) return;
    const toggle =
      playbackSpace &&
      previous.playbackSpace &&
      previous.url === url &&
      previous.sidebarOpen !== sidebarOpen;
    if (!toggle) {
      previousPlayback.current = { url, sidebarOpen, playbackSpace };
      handles.browser.SetVisible(visible);
      return;
    }
    let cancelled = false;
    // Show before resuming, and finish sending pause before hiding. Dropdowns
    // only change visible; they never change sidebarOpen or toggle playback.
    if (sidebarOpen) handles.browser.SetVisible(visible);
    // Steam closes QAM before its combobox commits aria-expanded. Wait for
    // that short transition so a dropdown can suppress the pending key.
    const timer = setTimeout(() => {
      previousPlayback.current = { url, sidebarOpen, playbackSpace };
      void sendWebSpace(handles.view.URL || url)
        .catch((error: unknown) =>
          toaster.toast({ title: '网页空格快捷键发送失败', body: String(error) }),
        )
        .finally(() => {
          if (!cancelled && !sidebarOpen) handles.browser.SetVisible(visible);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handles, visible, url, sidebarOpen, playbackSpace, suppressPlayback]);

  useEffect(() => {
    if (!handles) return;
    let cancelled = false;
    try {
      const path = localPathFromUrl(url);
      if (path !== null) {
        void prepareLocalFile(path).then(
          (result) => {
            if (!cancelled) handles.view.LoadURL(result.url);
          },
          (error: unknown) => {
            if (!cancelled) toaster.toast({ title: '无法打开本地文件', body: String(error) });
          },
        );
      } else {
        handles.view.LoadURL(url);
      }
    } catch (error) {
      toaster.toast({ title: '无法打开本地文件', body: String(error) });
    }
    return () => {
      cancelled = true;
    };
  }, [url, handles]);

  useEffect(() => {
    if (preserveHiddenBounds && !visible) return;
    handles?.browser.SetBounds(
      x,
      y + (web ? WEB_HEADER_HEIGHT : 0),
      width,
      Math.max(1, height - (web ? WEB_HEADER_HEIGHT : 0)),
    );
  }, [handles, x, y, width, height, preserveHiddenBounds, visible, web]);

  useEffect(() => {
    return () => handles?.view.Destroy();
  }, [handles]);

  return web && visible && handles ? (
    <WebHeader
      title={pageTitle || ''}
      getUrl={() => handles.view.URL || url}
      x={x}
      y={y}
      width={width}
    />
  ) : null;
};

const getBounds = (windowView?: DeckWindow | null) => {
  return {
    x: windowView?.screenLeft ?? 0,
    y: windowView?.screenTop ?? 0,
    width: windowView?.outerWidth ?? 0,
    height: windowView?.outerHeight ?? 0,
  };
};

const getOwnerWindow = (trees: NavTree[], id: string) => {
  const tree = trees.find((tree) => (tree.id ?? tree.m_ID) === id);
  return (
    tree?.Root?.Element?.ownerDocument?.defaultView ??
    tree?.m_Root?.m_element?.ownerDocument?.defaultView ??
    null
  );
};

const getQuickAccessBounds = (windowView: DeckWindow | null) => {
  const bounds = getBounds(windowView);
  const doc = windowView?.document;
  const tabs = doc?.querySelector?.(`[class~="${quickAccessMenuClasses.Tabs}"]`);
  const panels = doc?.querySelectorAll?.(`[class~="${quickAccessMenuClasses.TabGroupPanel}"]`);
  const panelWidth = Math.max(
    0,
    ...Array.from(panels ?? []).map((p) => p.getBoundingClientRect().width),
  );
  const contentWidth = (tabs?.getBoundingClientRect().width ?? 0) + panelWidth;
  // CEF popup outerWidth may describe its full-screen transparent backing surface.
  if (contentWidth > 0) bounds.width = contentWidth;
  if (bounds.width <= 0 || bounds.width >= SCREEN_WIDTH) bounds.width = 348;
  return bounds;
};

const getDeckComponentBounds = () => {
  const trees = (getGamepadNavigationTrees() ?? []) as NavTree[];

  const nav = getOwnerWindow(trees, 'MainNavMenuContainer');
  const openSideMenu = getOpenSideMenu();
  const navHidden =
    openSideMenu === undefined ? (nav?.document.hidden ?? true) : openSideMenu !== 1;
  const navBounds = navHidden ? null : getBounds(nav);

  const qam = getOwnerWindow(trees, 'QuickAccess-NA');
  const qamHidden =
    openSideMenu === undefined ? (qam?.document.hidden ?? true) : openSideMenu !== 2;
  const qamBounds = qamHidden ? null : getQuickAccessBounds(qam);
  // Steam may unmount the entire QAM body while showing a dropdown. Observe
  // the actual listbox in its main window as well as the original combobox.
  const main = getOwnerWindow(trees, 'GamepadUI_Full_Root') ?? getOwnerWindow(trees, 'root_1_');
  const listbox = main?.document.querySelector?.('[role="listbox"]');
  const dropdownOpen =
    (listbox?.getBoundingClientRect().width ?? 0) > 0 ||
    qam?.document
      .querySelector?.('[role="combobox"][aria-expanded="true"]')
      ?.getAttribute?.('aria-expanded') === 'true';

  const virtualKeyboard = getOwnerWindow(trees, 'virtual keyboard');
  const virtualKeyboardHidden = !(
    isVirtualKeyboardShowing() ??
    (virtualKeyboard && !virtualKeyboard.document.hidden)
  );
  // this is a guess, gotta figure out how to inspect to keyboard DOM
  const virtualKeyboardBounds = virtualKeyboardHidden
    ? null
    : {
        x: 0,
        y: SCREEN_HEIGHT - 240,
        width: SCREEN_WIDTH,
        height: 240,
      };

  return {
    nav: navBounds,
    qam: qamBounds,
    virtualKeyboard: virtualKeyboardBounds,
    qamOpen: !qamHidden,
    dropdownOpen,
    pageTitle: (window as unknown as { portal?: BrowserViewHandle }).portal?.Title,
  };
};

const areRectanglesEqual = (
  first: { x: number; y: number; width: number; height: number } | null,
  second: { x: number; y: number; width: number; height: number } | null,
) => {
  if (!first && !second) {
    return true;
  }

  if (!first || !second) {
    return false;
  }

  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
};

const areDeckComponentBoundsEqual = (
  first: ReturnType<typeof getDeckComponentBounds>,
  second: ReturnType<typeof getDeckComponentBounds>,
) => {
  return (
    areRectanglesEqual(first.nav, second.nav) &&
    areRectanglesEqual(first.qam, second.qam) &&
    areRectanglesEqual(first.virtualKeyboard, second.virtualKeyboard) &&
    first.qamOpen === second.qamOpen &&
    first.dropdownOpen === second.dropdownOpen &&
    first.pageTitle === second.pageTitle
  );
};

const useDeckComponentBounds = () => {
  const [state, setState] = useState(getDeckComponentBounds);

  useEffect(() => {
    const interval = setInterval(() => {
      setState((current) => {
        const next = getDeckComponentBounds();
        return areDeckComponentBoundsEqual(next, current) ? current : next;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return state;
};

export const PortalView = () => {
  const { nav, qam, virtualKeyboard, qamOpen, dropdownOpen, pageTitle } = useDeckComponentBounds();
  const [{ url, visible, sidebarVideoSpace, rightStickFullscreen, activePanel }, setGlobalState] =
    useGlobalState();
  const readerVisible = !!url && visible && !activePanel && !dropdownOpen && qamOpen;
  const closePanel = () =>
    setGlobalState((state) => ({ ...state, activePanel: undefined, visible: true }));
  const Panel = activePanel
    ? { url: UrlModal, phone: PhoneUrlModal, history: UrlHistoryModal, files: LocalFilesModal }[
        activePanel
      ]
    : undefined;
  const localPath = (() => {
    try {
      return localPathFromUrl(url);
    } catch {
      return null;
    }
  })();

  const availableBounds = [
    {
      x: 0,
      y: 0,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT,
    },
  ];

  if (nav) {
    availableBounds.push({
      x: nav.width,
      y: 0,
      width: SCREEN_WIDTH - nav.width,
      height: SCREEN_HEIGHT,
    });
  }

  if (qam) {
    availableBounds.push({
      x: 0,
      y: 0,
      width: SCREEN_WIDTH - qam.width,
      height: SCREEN_HEIGHT,
    });
  }

  if (virtualKeyboard) {
    availableBounds.push({
      x: 0,
      y: 0,
      width: SCREEN_WIDTH,
      height: SCREEN_HEIGHT - virtualKeyboard.height,
    });
  }

  const bounds = intersectRectangles(availableBounds) ?? {
    x: 0,
    y: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  };

  return (
    <>
      {url && (
        <Browser
          url={url}
          visible={readerVisible}
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          preserveHiddenBounds
          sidebarOpen={qamOpen}
          playbackSpace={sidebarVideoSpace === true && /^https?:\/\//i.test(url)}
          suppressPlayback={dropdownOpen || !!activePanel}
          pageTitle={pageTitle}
        />
      )}
      {readerVisible && (
        <ReaderInput
          key={url}
          path={localPath ?? undefined}
          fullscreen={rightStickFullscreen === true && /^https?:\/\//i.test(url)}
        />
      )}
      {Panel && (
        <div
          aria-label="Portal 左侧面板"
          style={{
            position: 'absolute',
            zIndex: 7001,
            left: bounds.x,
            top: bounds.y,
            width: bounds.width,
            height: bounds.height,
            display: qamOpen ? 'block' : 'none',
            overflow: 'hidden',
            pointerEvents: 'auto',
          }}
        >
          <Panel closeModal={closePanel} />
        </div>
      )}
    </>
  );
};

export const PortalViewOuter = () => {
  const [{ viewMode, activePanel }] = useGlobalState();

  if (viewMode === ViewMode.Closed && !activePanel) {
    return null;
  }

  return <PortalView />;
};
