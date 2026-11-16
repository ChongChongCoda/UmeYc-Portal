import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { Router } from '@decky/ui';
import { prepareLocalFileMock, sendWebSpaceMock } from '../__mocks__/decky-api';
import { toLocalFileUrl } from '../lib/local-files';
import { getOpenSideMenu, isVirtualKeyboardShowing } from '../lib/menu-state';

vi.mock('../lib/menu-state', () => ({
  getOpenSideMenu: vi.fn(),
  isVirtualKeyboardShowing: vi.fn(),
}));
vi.mock('./reader-input', () => ({ ReaderInput: () => <div data-testid="reader-input" /> }));

import { PortalView, PortalViewOuter } from './portal-view';
import { useGlobalState } from '../hooks/global-state';
import { Position, ViewMode } from '../lib/util';

const getGamepadNavigationTrees = vi.fn();
const createBrowserView = vi.fn();
const setVisible = vi.fn();
const setBounds = vi.fn();
const loadURL = vi.fn();
const destroy = vi.fn();
const useUIComposition = vi.fn();

vi.mock('../hooks/global-state', () => ({
  useGlobalState: vi.fn(),
}));

vi.mock('./minimised-indicator', () => ({
  MinimisedIndicator: ({ position, margin }: { position: number; margin: number }) => (
    <div data-testid="minimised-indicator" data-position={position} data-margin={margin} />
  ),
}));

vi.mock('../hooks/use-ui-composition', () => ({
  UIComposition: {
    Notification: 1,
  },
  useUIComposition: (...args: unknown[]) => useUIComposition(...args),
}));

vi.mock('@decky/ui', () => ({
  quickAccessMenuClasses: { Tabs: 'tabs', TabGroupPanel: 'panel' },
  Router: {
    WindowStore: {
      GamepadUIMainWindowInstance: {
        CreateBrowserView: (...args: unknown[]) => createBrowserView(...args),
      },
    },
  },
  WindowRouter: {},
  getGamepadNavigationTrees: (...args: unknown[]) => getGamepadNavigationTrees(...args),
}));

const createState = (viewMode: ViewMode, position = Position.TopRight, margin = 20) => ({
  viewMode,
  previousViewMode: ViewMode.Picture,
  visible: true,
  position,
  margin,
  size: 1,
  url: 'https://netflix.com',
  controlBar: true,
});

// BAR_WIDTH = 48
// PICTURE_WIDTH = 854 * 0.4 = 341.6
// PICTURE_HEIGHT = 341.6 / 1.85 ≈ 184.6486
// Bar extends outside PiP bounds, so browserWidth = pictureWidth = 341.6

describe('PortalView and PortalViewOuter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOpenSideMenu).mockReturnValue(undefined);
    vi.mocked(isVirtualKeyboardShowing).mockReturnValue(undefined);

    createBrowserView.mockReturnValue({
      GetBrowser: () => ({
        SetVisible: setVisible,
        SetBounds: setBounds,
      }),
      LoadURL: loadURL,
      Destroy: destroy,
    });

    getGamepadNavigationTrees.mockReturnValue([]);
  });

  it('returns null from outer component when closed', () => {
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Closed)] as never);

    const { container } = render(<PortalViewOuter />);

    expect(container).toBeEmptyDOMElement();
    expect(createBrowserView).not.toHaveBeenCalled();
  });

  const qamTree = () => ({
    id: 'QuickAccess-NA',
    m_Root: {
      m_element: {
        ownerDocument: {
          defaultView: {
            document: { hidden: false },
            screenLeft: 534,
            screenTop: 0,
            outerWidth: 320,
            outerHeight: 534,
          },
        },
      },
    },
  });

  it('sends space on sidebar edges only and pauses before hiding', async () => {
    vi.useFakeTimers();
    let finishPause!: () => void;
    try {
      getGamepadNavigationTrees.mockReturnValue([qamTree()]);
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      vi.mocked(useGlobalState).mockReturnValue([
        { ...createState(ViewMode.Sidebar), sidebarVideoSpace: true },
      ] as never);
      sendWebSpaceMock.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishPause = resolve;
          }),
      );
      const { unmount } = render(<PortalView />);
      expect(sendWebSpaceMock).not.toHaveBeenCalled();
      vi.mocked(getOpenSideMenu).mockReturnValue(0);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(sendWebSpaceMock).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(sendWebSpaceMock).toHaveBeenCalledWith('https://netflix.com');
      expect(setVisible).toHaveBeenLastCalledWith(true);
      await act(async () => {
        finishPause();
      });
      expect(setVisible).toHaveBeenLastCalledWith(false);
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(true);
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(sendWebSpaceMock).toHaveBeenCalledTimes(2);
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(sendWebSpaceMock).toHaveBeenCalledTimes(2);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not toggle video when a dropdown temporarily hides the page', async () => {
    vi.useFakeTimers();
    try {
      let opened = false;
      const tree = qamTree();
      const mainTree = {
        id: 'GamepadUI_Full_Root',
        Root: {
          Element: {
            ownerDocument: {
              defaultView: {
                document: {
                  hidden: false,
                  querySelector: (s: string) =>
                    s.includes('listbox') && opened
                      ? { getBoundingClientRect: () => ({ width: 280 }) }
                      : null,
                },
              },
            },
          },
        },
      };
      getGamepadNavigationTrees.mockReturnValue([tree]);
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      vi.mocked(useGlobalState).mockReturnValue([
        { ...createState(ViewMode.Sidebar), sidebarVideoSpace: true },
      ] as never);
      const { unmount } = render(<PortalView />);
      // Steam closes QAM while presenting its dropdown in the main window.
      vi.mocked(getOpenSideMenu).mockReturnValue(0);
      getGamepadNavigationTrees.mockReturnValue([mainTree]);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(sendWebSpaceMock).not.toHaveBeenCalled();
      opened = true;
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(false);
      opened = false;
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      getGamepadNavigationTrees.mockReturnValue([tree]);
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(true);
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(sendWebSpaceMock).not.toHaveBeenCalled();
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([ViewMode.Sidebar, ViewMode.Expand])(
    'keeps native dropdowns clickable in layout %s and restores on cancellation',
    (mode) => {
      vi.useFakeTimers();
      try {
        let opened = false;
        const tree = qamTree();
        Object.assign(tree.m_Root.m_element.ownerDocument.defaultView.document, {
          querySelector: (selector: string) =>
            selector.includes('aria-expanded') && opened ? { getAttribute: () => 'true' } : null,
        });
        getGamepadNavigationTrees.mockReturnValue([tree]);
        vi.mocked(getOpenSideMenu).mockReturnValue(2);
        vi.mocked(useGlobalState).mockReturnValue([createState(mode)] as never);
        const { unmount } = render(<PortalView />);
        expect(setVisible).toHaveBeenLastCalledWith(true);
        opened = true;
        act(() => {
          vi.advanceTimersByTime(100);
        });
        expect(setVisible).toHaveBeenLastCalledWith(false);
        expect(destroy).not.toHaveBeenCalled();
        opened = false;
        act(() => {
          vi.advanceTimersByTime(100);
        });
        expect(setVisible).toHaveBeenLastCalledWith(true);
        expect(createBrowserView).toHaveBeenCalledTimes(1);
        unmount();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('fills the area left of QAM and hides without resizing or destroying on close', () => {
    vi.useFakeTimers();
    try {
      getGamepadNavigationTrees.mockReturnValue([qamTree()]);
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      vi.mocked(useGlobalState).mockReturnValue([
        { ...createState(ViewMode.Sidebar), url: toLocalFileUrl('/tmp/guide.JPG') },
      ] as never);
      prepareLocalFileMock.mockResolvedValue({ url: 'http://127.0.0.1:1234/viewer/token' });
      const { container } = render(<PortalView />);
      expect(setBounds).toHaveBeenLastCalledWith(0, 0, 534, 534);
      expect(setVisible).toHaveBeenLastCalledWith(true);
      expect(container.querySelector('[data-testid="reader-input"]')).toBeTruthy();
      vi.mocked(getOpenSideMenu).mockReturnValue(0);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(false);
      expect(setBounds).toHaveBeenLastCalledWith(0, 0, 534, 534);
      expect(destroy).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="reader-input"]')).toBeNull();
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(setVisible).toHaveBeenLastCalledWith(true);
      expect(createBrowserView).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores fullscreen width after QAM closes even when popup document stays visible', () => {
    vi.useFakeTimers();
    try {
      getGamepadNavigationTrees.mockReturnValue([qamTree()]);
      vi.mocked(getOpenSideMenu).mockReturnValue(2);
      vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Expand)] as never);
      render(<PortalView />);
      expect(setBounds).toHaveBeenLastCalledWith(30, 30, 426, 474);
      vi.mocked(getOpenSideMenu).mockReturnValue(0);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(setBounds).toHaveBeenLastCalledWith(30, 30, 746, 474);
      expect(setVisible).toHaveBeenLastCalledWith(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('measures the sidebar content rather than its full-screen transparent popup', () => {
    const popup = {
      document: {
        hidden: false,
        querySelector: () => ({ getBoundingClientRect: () => ({ width: 48 }) }),
        querySelectorAll: () => [{ getBoundingClientRect: () => ({ width: 300 }) }],
      },
      outerWidth: 854,
      outerHeight: 534,
    };
    getGamepadNavigationTrees.mockReturnValue([
      { m_ID: 'QuickAccess-NA', Root: { Element: { ownerDocument: { defaultView: popup } } } },
    ]);
    vi.mocked(getOpenSideMenu).mockReturnValue(2);
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);
    render(<PortalView />);
    expect(setBounds).toHaveBeenLastCalledWith(0, 0, 506, 534);
  });

  it('ignores a retained keyboard navigation tree after the keyboard is dismissed', () => {
    getGamepadNavigationTrees.mockReturnValue([
      qamTree(),
      {
        id: 'virtual keyboard',
        m_Root: { m_element: { ownerDocument: { defaultView: { document: { hidden: false } } } } },
      },
    ]);
    vi.mocked(getOpenSideMenu).mockReturnValue(2);
    vi.mocked(isVirtualKeyboardShowing).mockReturnValue(false);
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);
    render(<PortalView />);
    expect(setBounds).toHaveBeenLastCalledWith(0, 0, 534, 534);
  });

  it('keeps sidebar height after a physical touch clears Steam focus', async () => {
    const actual = await vi.importActual<typeof import('../lib/menu-state')>('../lib/menu-state');
    vi.mocked(getOpenSideMenu).mockImplementation(actual.getOpenSideMenu);
    vi.mocked(isVirtualKeyboardShowing).mockImplementation(actual.isVirtualKeyboardShowing);
    let menu = 2;
    const main = {
      MenuStore: { GetOpenSideMenu: () => menu },
      VirtualKeyboardManager: { IsShowingVirtualKeyboard: { Value: false } },
    };
    let focused: typeof main | null = main;
    const host = window as unknown as { SteamUIStore?: unknown };
    host.SteamUIStore = {
      GetFocusedWindowInstance: () => focused,
      WindowStore: { GamepadUIMainWindowInstance: main },
    };
    vi.useFakeTimers();
    try {
      getGamepadNavigationTrees.mockReturnValue([
        qamTree(),
        {
          id: 'virtual keyboard',
          m_Root: {
            m_element: { ownerDocument: { defaultView: { document: { hidden: false } } } },
          },
        },
      ]);
      vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Sidebar)] as never);
      const { unmount } = render(<PortalView />);
      expect(setBounds).toHaveBeenLastCalledWith(0, 0, 534, 534);
      focused = null;
      act(() => vi.advanceTimersByTime(100));
      expect(setBounds).toHaveBeenLastCalledWith(0, 0, 534, 534);
      expect(setBounds).toHaveBeenCalledTimes(1);

      main.VirtualKeyboardManager.IsShowingVirtualKeyboard.Value = true;
      act(() => vi.advanceTimersByTime(100));
      expect(setBounds).toHaveBeenLastCalledWith(0, 0, 534, 294);
      main.VirtualKeyboardManager.IsShowingVirtualKeyboard.Value = false;
      act(() => vi.advanceTimersByTime(100));
      expect(setBounds).toHaveBeenLastCalledWith(0, 0, 534, 534);

      menu = 0;
      act(() => vi.advanceTimersByTime(100));
      expect(setVisible).toHaveBeenLastCalledWith(false);
      menu = 2;
      act(() => vi.advanceTimersByTime(100));
      expect(setVisible).toHaveBeenLastCalledWith(true);
      expect(setBounds).toHaveBeenLastCalledWith(0, 0, 534, 534);
      expect(createBrowserView).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      delete host.SteamUIStore;
      vi.useRealTimers();
    }
  });

  it('resolves a fresh preview address for a persisted local file', async () => {
    const path = '/run/media/deck/SD/明末第一章.JPG';
    const state = { ...createState(ViewMode.Picture), url: toLocalFileUrl(path) };
    vi.mocked(useGlobalState).mockReturnValue([state] as never);
    prepareLocalFileMock.mockResolvedValueOnce({ url: 'http://127.0.0.1:1234/viewer/new-token' });
    render(<PortalView />);
    await waitFor(() =>
      expect(loadURL).toHaveBeenCalledWith('http://127.0.0.1:1234/viewer/new-token'),
    );
    expect(prepareLocalFileMock).toHaveBeenCalledWith(path);
  });

  it('ignores a local preview response after switching back to a website', async () => {
    let resolve!: (value: { url: string }) => void;
    prepareLocalFileMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    vi.mocked(useGlobalState).mockReturnValue([
      { ...createState(ViewMode.Picture), url: toLocalFileUrl('/tmp/guide.JPG') },
    ] as never);
    const { rerender } = render(<PortalView />);
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Picture)] as never);
    rerender(<PortalView />);
    await act(async () => {
      resolve({ url: 'http://127.0.0.1:1234/viewer/stale' });
    });
    expect(loadURL).toHaveBeenLastCalledWith('https://netflix.com');
    expect(loadURL).not.toHaveBeenCalledWith('http://127.0.0.1:1234/viewer/stale');
  });

  it('renders portal view from outer component when open', () => {
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Picture)] as never);

    render(<PortalViewOuter />);

    expect(createBrowserView).toHaveBeenCalledTimes(1);
  });

  it('creates browser view when minimised (keeps it alive) and renders indicator', () => {
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Minimised)] as never);

    const { container } = render(<PortalViewOuter />);

    expect(createBrowserView).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="minimised-indicator"]')).toBeTruthy();
  });

  it('sets bounds to 0x0 and hides browser when minimised', async () => {
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Minimised)] as never);

    render(<PortalView />);

    await waitFor(() => {
      expect(setBounds).toHaveBeenCalled();
    });

    const [x, y, width, height] = setBounds.mock.calls[setBounds.mock.calls.length - 1];
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(width).toBe(0);
    expect(height).toBe(0);
    expect(setVisible).toHaveBeenCalledWith(false);
  });

  it('renders gracefully when decky main window instance is unavailable', () => {
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Picture)] as never);

    const original = Router.WindowStore!.GamepadUIMainWindowInstance;
    Router.WindowStore!.GamepadUIMainWindowInstance = undefined as never;

    try {
      const { container } = render(<PortalView />);
      expect(container.querySelector('[data-testid="control-bar"]')).toBeTruthy();
      expect(createBrowserView).not.toHaveBeenCalled();
    } finally {
      Router.WindowStore!.GamepadUIMainWindowInstance = original;
    }
  });

  it('creates browser view and updates visibility, url, and bounds in picture mode', async () => {
    vi.mocked(useGlobalState).mockReturnValue([
      createState(ViewMode.Picture, Position.TopRight, 20),
    ] as never);

    const { unmount } = render(<PortalView />);

    await waitFor(() => {
      expect(setVisible).toHaveBeenCalledWith(true);
      expect(loadURL).toHaveBeenCalledWith('https://netflix.com');
      expect(setBounds).toHaveBeenCalled();
    });

    // TopRight → bar extends outside, browserX = bounds.x = 492.4
    const [x, y, width, height] = setBounds.mock.calls[setBounds.mock.calls.length - 1];
    expect(x).toBeCloseTo(492.4, 3);
    expect(y).toBeCloseTo(20, 3);
    expect(width).toBeCloseTo(341.6, 3);
    expect(height).toBeCloseTo(184.6486, 3);

    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(useUIComposition).toHaveBeenCalledWith(1);
  });

  it('uses expanded layout margin and deck component bounds intersection', async () => {
    getGamepadNavigationTrees.mockReturnValue([
      {
        id: 'MainNavMenuContainer',
        m_Root: {
          m_element: {
            ownerDocument: {
              defaultView: {
                document: { hidden: false },
                screenLeft: 0,
                screenTop: 0,
                outerWidth: 100,
                outerHeight: 534,
              },
            },
          },
        },
      },
      {
        id: 'QuickAccess-NA',
        m_Root: {
          m_element: {
            ownerDocument: {
              defaultView: {
                document: { hidden: false },
                screenLeft: 0,
                screenTop: 0,
                outerWidth: 200,
                outerHeight: 534,
              },
            },
          },
        },
      },
      {
        id: 'virtual keyboard',
        m_Root: {
          m_element: {
            ownerDocument: {
              defaultView: {
                document: { hidden: false },
              },
            },
          },
        },
      },
    ]);

    vi.mocked(useGlobalState).mockReturnValue([
      createState(ViewMode.Expand, Position.BottomRight, 10),
    ] as never);

    render(<PortalView />);

    await waitFor(() => {
      expect(setBounds).toHaveBeenCalled();
    });

    // Expand mode → bar shrinks browser width: browserWidth = 494 - 48 = 446
    const [x, y, width, height] = setBounds.mock.calls[setBounds.mock.calls.length - 1];
    expect(x).toBe(130);
    expect(y).toBe(30);
    expect(width).toBe(446);
    expect(height).toBe(234);
  });

  it.each([
    // Bar extends outside PiP bounds, browserX = bounds.x, browserWidth = 341.6
    [Position.Top, 256.2, 20],
    [Position.TopRight, 492.4, 20],
    [Position.Right, 492.4, 174.6757],
    [Position.BottomRight, 492.4, 329.3514],
    [Position.Bottom, 256.2, 329.3514],
    [Position.BottomLeft, 20, 329.3514],
    [Position.Left, 20, 174.6757],
    [Position.TopLeft, 20, 20],
  ])('places picture mode correctly for position %s', async (position, expectedX, expectedY) => {
    vi.mocked(useGlobalState).mockReturnValue([
      createState(ViewMode.Picture, position as Position, 20),
    ] as never);

    render(<PortalView />);

    await waitFor(() => {
      expect(setBounds).toHaveBeenCalled();
    });

    const [x, y, width, height] = setBounds.mock.calls[setBounds.mock.calls.length - 1];
    expect(x).toBeCloseTo(expectedX, 3);
    expect(y).toBeCloseTo(expectedY, 3);
    expect(width).toBeCloseTo(341.6, 3);
    expect(height).toBeCloseTo(184.6486, 3);
  });

  it('hides control bar when visible is false', () => {
    const state = createState(ViewMode.Picture);
    state.visible = false;
    vi.mocked(useGlobalState).mockReturnValue([state] as never);

    const { container } = render(<PortalView />);

    expect(container.querySelector('[data-testid="control-bar"]')).toBeNull();
  });

  it('shows control bar when visible is true', () => {
    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Picture)] as never);

    const { container } = render(<PortalView />);

    expect(container.querySelector('[data-testid="control-bar"]')).toBeTruthy();
  });

  it('updates deck component bounds only when interval polling detects changes', async () => {
    vi.useFakeTimers();

    let callCount = 0;
    getGamepadNavigationTrees.mockImplementation(() => {
      callCount += 1;

      if (callCount < 3) {
        return [];
      }

      return [
        {
          id: 'QuickAccess-NA',
          m_Root: {
            m_element: {
              ownerDocument: {
                defaultView: {
                  document: { hidden: false },
                  screenLeft: 0,
                  screenTop: 0,
                  outerWidth: 200,
                  outerHeight: 534,
                },
              },
            },
          },
        },
      ];
    });

    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Picture)] as never);

    try {
      render(<PortalView />);

      expect(setBounds).toHaveBeenCalled();
      const initialCalls = setBounds.mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(setBounds).toHaveBeenCalledTimes(initialCalls);

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(setBounds.mock.calls.length).toBeGreaterThan(initialCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides control bar when controlBar is false', () => {
    const state = createState(ViewMode.Picture);
    state.controlBar = false;
    vi.mocked(useGlobalState).mockReturnValue([state] as never);

    const { container } = render(<PortalView />);

    expect(container.querySelector('[data-testid="control-bar"]')).toBeNull();
  });

  it('keeps same bounds when polling returns equal non-null rectangles', () => {
    vi.useFakeTimers();

    getGamepadNavigationTrees.mockReturnValue([
      {
        id: 'QuickAccess-NA',
        m_Root: {
          m_element: {
            ownerDocument: {
              defaultView: {
                document: { hidden: false },
                screenLeft: 0,
                screenTop: 0,
                outerWidth: 200,
                outerHeight: 534,
              },
            },
          },
        },
      },
    ]);

    vi.mocked(useGlobalState).mockReturnValue([createState(ViewMode.Picture)] as never);

    try {
      render(<PortalView />);

      const initialCalls = setBounds.mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(setBounds).toHaveBeenCalledTimes(initialCalls);
    } finally {
      vi.useRealTimers();
    }
  });
});
