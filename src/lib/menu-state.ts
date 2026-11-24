interface MenuStore {
  GetOpenSideMenu(): number;
}

interface WindowInstance {
  MenuStore?: MenuStore;
  VirtualKeyboardManager?: { IsShowingVirtualKeyboard?: { Value: boolean } };
  LocationPathName?: string;
  BViewingPreLoginRoute?(): boolean;
  GetShowingGlobalModal?(): boolean;
  ModalManager?: { active_modal?: unknown };
}

const menuWindow = (): WindowInstance | undefined => {
  const host = window as unknown as {
    SteamUIStore?: {
      GetFocusedWindowInstance(): WindowInstance | null | undefined;
      WindowStore?: { GamepadUIMainWindowInstance?: WindowInstance };
    };
  };
  // Touching a BrowserView clears gamepad focus. The main window still owns the
  // live menu/keyboard state; a retained keyboard navigation tree is not proof
  // that the keyboard is open.
  return (
    host.SteamUIStore?.GetFocusedWindowInstance() ??
    host.SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance
  );
};

// A QAM popup remains mounted after closing; document.hidden is not its visibility.
export const getOpenSideMenu = (): number | undefined => {
  return menuWindow()?.MenuStore?.GetOpenSideMenu();
};

export const isVirtualKeyboardShowing = (): boolean | undefined =>
  menuWindow()?.VirtualKeyboardManager?.IsShowingVirtualKeyboard?.Value;

const PORTAL_TITLE_SELECTOR = '[data-umeyc-title]';
let portalTitleSeen = false;

/**
 * Decky renders a plugin's titleView only while that plugin's QAM page is
 * open, so its presence tells us the user is on the Portal page rather than
 * the plugin list. Older Decky versions may not expose it: fall back to the
 * plain side-menu state until the marker has been seen once.
 */
type QueryableDocument = { querySelector?: (selector: string) => unknown };

export const isPortalPageOpen = (
  qamDocument: QueryableDocument | null | undefined,
  mainDocument: QueryableDocument | null | undefined,
  qamOpen: boolean,
): boolean => {
  for (const doc of [qamDocument, mainDocument]) {
    try {
      const marker = doc?.querySelector?.(PORTAL_TITLE_SELECTOR) as
        | { getBoundingClientRect?: () => { width: number; height: number } }
        | null
        | undefined;
      if (marker) {
        // A retained but hidden titleView must not count as the open page.
        const rect = marker.getBoundingClientRect?.();
        if (!rect || rect.width > 0 || rect.height > 0) {
          portalTitleSeen = true;
          return true;
        }
      }
    } catch {
      // A QAM transition can detach the document mid-query.
    }
  }
  return portalTitleSeen ? false : qamOpen;
};

/** Test hook: forget markers seen by earlier renders. */
export const resetPortalPageDetection = (): void => {
  portalTitleSeen = false;
};

// Authentication errors are full routes rather than ModalManager dialogs. Read
// the main window even when a separate QAM/BrowserView currently owns focus.
export const isSteamBlockingUI = (): boolean => {
  const host = window as unknown as {
    SteamUIStore?: { WindowStore?: { GamepadUIMainWindowInstance?: WindowInstance } };
  };
  const main = host.SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance ?? menuWindow();
  return !!(
    main?.LocationPathName === '/error' ||
    main?.BViewingPreLoginRoute?.() ||
    main?.GetShowingGlobalModal?.() ||
    main?.ModalManager?.active_modal
  );
};
