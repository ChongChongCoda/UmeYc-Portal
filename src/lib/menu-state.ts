interface MenuStore {
  GetOpenSideMenu(): number;
}

interface WindowInstance {
  MenuStore?: MenuStore;
  VirtualKeyboardManager?: { IsShowingVirtualKeyboard?: { Value: boolean } };
}

const focusedWindow = (): WindowInstance | undefined => {
  const host = window as unknown as {
    SteamUIStore?: { GetFocusedWindowInstance(): WindowInstance | undefined };
  };
  return host.SteamUIStore?.GetFocusedWindowInstance();
};

// A QAM popup remains mounted after closing; document.hidden is not its visibility.
export const getOpenSideMenu = (): number | undefined => {
  return focusedWindow()?.MenuStore?.GetOpenSideMenu();
};

export const isVirtualKeyboardShowing = (): boolean | undefined =>
  focusedWindow()?.VirtualKeyboardManager?.IsShowingVirtualKeyboard?.Value;
