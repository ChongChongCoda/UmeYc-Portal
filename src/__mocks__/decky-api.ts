import { vi } from 'vitest';

export const definePlugin = vi.fn((factory: unknown) =>
  typeof factory === 'function' ? (factory as () => unknown)() : factory,
);

export const routerHook = {
  addGlobalComponent: vi.fn(),
  removeGlobalComponent: vi.fn(),
};

export const toaster = {
  toast: vi.fn(),
};

export const openFilePicker = vi.fn();
export const FileSelectionType = { FILE: 0, FOLDER: 1 };
export const prepareLocalFileMock = vi.fn();
export const setReaderMotionMock = vi.fn(async () => undefined);
export const callable = vi.fn((route: string) =>
  route === 'set_reader_motion' ? setReaderMotionMock : prepareLocalFileMock,
);
