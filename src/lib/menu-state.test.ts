import { afterEach, describe, expect, it } from 'vitest';
import { getOpenSideMenu, isSteamBlockingUI, isVirtualKeyboardShowing } from './menu-state';

const createWindow = (menu: number, keyboard: boolean) => ({
  MenuStore: { GetOpenSideMenu: () => menu },
  VirtualKeyboardManager: { IsShowingVirtualKeyboard: { Value: keyboard } },
  LocationPathName: '/library',
  BViewingPreLoginRoute: () => false,
  GetShowingGlobalModal: () => false,
  ModalManager: { active_modal: undefined as unknown },
});

const host = window as unknown as {
  SteamUIStore?: {
    GetFocusedWindowInstance(): ReturnType<typeof createWindow> | null | undefined;
    WindowStore?: { GamepadUIMainWindowInstance?: ReturnType<typeof createWindow> };
  };
};

afterEach(() => {
  delete host.SteamUIStore;
});

describe('Steam menu and keyboard state', () => {
  it('detects credential errors in the main window while QAM owns focus', () => {
    const main = createWindow(0, false);
    host.SteamUIStore = {
      GetFocusedWindowInstance: () => createWindow(2, false),
      WindowStore: { GamepadUIMainWindowInstance: main },
    };
    expect(isSteamBlockingUI()).toBe(false);
    main.LocationPathName = '/error';
    expect(isSteamBlockingUI()).toBe(true);
    main.LocationPathName = '/library';
    main.BViewingPreLoginRoute = () => true;
    expect(isSteamBlockingUI()).toBe(true);
    main.BViewingPreLoginRoute = () => false;
    main.GetShowingGlobalModal = () => true;
    expect(isSteamBlockingUI()).toBe(true);
    main.GetShowingGlobalModal = () => false;
    main.ModalManager.active_modal = {};
    expect(isSteamBlockingUI()).toBe(true);
    main.ModalManager.active_modal = undefined;
    expect(isSteamBlockingUI()).toBe(false);
  });

  it('does not block Portal before Steam initializes', () => {
    expect(isSteamBlockingUI()).toBe(false);
  });

  it('reads the focused window when one exists', () => {
    host.SteamUIStore = {
      GetFocusedWindowInstance: () => createWindow(1, true),
      WindowStore: { GamepadUIMainWindowInstance: createWindow(2, false) },
    };
    expect(getOpenSideMenu()).toBe(1);
    expect(isVirtualKeyboardShowing()).toBe(true);
  });

  it.each([null, undefined])('uses the main window when focus is %s after a touch', (focus) => {
    host.SteamUIStore = {
      GetFocusedWindowInstance: () => focus,
      WindowStore: { GamepadUIMainWindowInstance: createWindow(2, false) },
    };
    expect(getOpenSideMenu()).toBe(2);
    expect(isVirtualKeyboardShowing()).toBe(false);
  });

  it('keeps reading live keyboard and menu state while the browser has focus', () => {
    let menu = 2;
    const main = createWindow(menu, false);
    main.MenuStore.GetOpenSideMenu = () => menu;
    host.SteamUIStore = {
      GetFocusedWindowInstance: () => null,
      WindowStore: { GamepadUIMainWindowInstance: main },
    };
    expect(isVirtualKeyboardShowing()).toBe(false);
    main.VirtualKeyboardManager.IsShowingVirtualKeyboard.Value = true;
    expect(isVirtualKeyboardShowing()).toBe(true);
    main.VirtualKeyboardManager.IsShowingVirtualKeyboard.Value = false;
    menu = 0;
    expect(isVirtualKeyboardShowing()).toBe(false);
    expect(getOpenSideMenu()).toBe(0);
  });

  it('supports a focused window when the main-window store is unavailable', () => {
    host.SteamUIStore = { GetFocusedWindowInstance: () => createWindow(0, false) };
    expect(getOpenSideMenu()).toBe(0);
    expect(isVirtualKeyboardShowing()).toBe(false);
  });

  it('reports unknown state when neither window is available', () => {
    host.SteamUIStore = { GetFocusedWindowInstance: () => null };
    expect(getOpenSideMenu()).toBeUndefined();
    expect(isVirtualKeyboardShowing()).toBeUndefined();
  });

  it('reports unknown state before Steam initializes', () => {
    expect(getOpenSideMenu()).toBeUndefined();
    expect(isVirtualKeyboardShowing()).toBeUndefined();
  });
});
