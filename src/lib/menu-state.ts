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
