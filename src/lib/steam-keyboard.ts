import { Router } from '@decky/ui';

// Steam's GamepadUI owns the on-screen keyboard. Calling it through this
// manager gives us each key/commit as a callback instead of relying on the
// keyboard to type into a focused element. That matters for Chinese IME:
// the committed candidate text is handed to `onTextEntered` directly, so it
// cannot get lost between CEF frames.

export interface SteamKeyboardOptions {
  onTextEntered?: (text: string) => void;
  onEnterKeyPress?: (() => string | null | undefined) | string;
  onKeyboardShow?: () => void;
  onKeyboardFullyVisible?: () => void;
  strEnterKeyLabel?: string;
  BIsElementValidForInput?: () => boolean;
}

export interface SteamKeyboardRef {
  ShowVirtualKeyboard(): void;
  ShowModalKeyboard(): void;
  SetAsCurrentVirtualKeyboardTarget(): void;
  HideVirtualKeyboard(): void;
  BIsActive?(): boolean;
}

export interface SteamVirtualKeyboardManager {
  CreateVirtualKeyboardRef(options?: SteamKeyboardOptions): SteamKeyboardRef;
  SetDismissOnEnterKey?(dismiss: boolean): void;
}

type WindowWithKeyboard = {
  VirtualKeyboardManager?: SteamVirtualKeyboardManager;
};

type WindowStoreWithKeyboard = {
  GamepadUIMainWindowInstance?: WindowWithKeyboard;
  SteamUIWindows?: WindowWithKeyboard[];
};

type SteamUIHost = {
  GetFocusedWindowInstance?(): WindowWithKeyboard | null | undefined;
  WindowStore?: WindowStoreWithKeyboard;
};

const managerOf = (candidate?: WindowWithKeyboard | null) => {
  const manager = candidate?.VirtualKeyboardManager;
  return manager && typeof manager.CreateVirtualKeyboardRef === 'function' ? manager : undefined;
};

export const getVirtualKeyboardManager = (): SteamVirtualKeyboardManager | undefined => {
  try {
    const host = (window as unknown as { SteamUIStore?: SteamUIHost }).SteamUIStore;
    const store = host?.WindowStore;
    const routerStore = Router?.WindowStore as WindowStoreWithKeyboard | undefined;
    // Mirror Steam's own `isVirtualKeyboardShowing` lookup: the QAM's focused
    // window owns the live keyboard. Falling back to an unrelated hidden
    // window produces a keyboard that never becomes visible.
    const candidates: (WindowWithKeyboard | null | undefined)[] = [
      host?.GetFocusedWindowInstance?.(),
      store?.GamepadUIMainWindowInstance,
      routerStore?.GamepadUIMainWindowInstance,
      ...(store?.SteamUIWindows ?? []),
      ...(routerStore?.SteamUIWindows ?? []),
    ];
    for (const candidate of candidates) {
      const manager = managerOf(candidate);
      if (manager) return manager;
    }
    return undefined;
  } catch {
    return undefined;
  }
};
