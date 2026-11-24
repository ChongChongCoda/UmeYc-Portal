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

const findManager = (store?: WindowStoreWithKeyboard) => {
  const candidates = [
    store?.GamepadUIMainWindowInstance,
    ...(store?.SteamUIWindows ?? []),
  ];
  for (const candidate of candidates) {
    const manager = candidate?.VirtualKeyboardManager;
    if (manager && typeof manager.CreateVirtualKeyboardRef === 'function') return manager;
  }
  return undefined;
};

export const getVirtualKeyboardManager = (): SteamVirtualKeyboardManager | undefined => {
  try {
    const host = window as unknown as {
      SteamUIStore?: { WindowStore?: WindowStoreWithKeyboard };
    };
    return (
      findManager(Router?.WindowStore as WindowStoreWithKeyboard | undefined) ??
      findManager(host.SteamUIStore?.WindowStore)
    );
  } catch {
    return undefined;
  }
};
