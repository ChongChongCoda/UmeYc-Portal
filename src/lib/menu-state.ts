interface MenuStore {
  GetOpenSideMenu(): number;
}

interface WindowInstance {
  MenuStore?: MenuStore;
  VirtualKeyboardManager?: { IsShowingVirtualKeyboard?: { Value: boolean } };
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
