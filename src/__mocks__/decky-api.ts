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
export const listLocalFilesMock = vi.fn<(directory: string) => Promise<unknown>>();
export const deleteLocalFileMock = vi.fn();
export const listOfflineCollectionsMock = vi.fn();
export const openOfflineCollectionMock = vi.fn();
export const deleteOfflineCollectionMock = vi.fn();
export const planStorageMigrationMock = vi.fn();
export const startStorageMigrationMock = vi.fn();
export const getStorageMigrationStatusMock = vi.fn();
export const cancelStorageMigrationMock = vi.fn();
export const saveOfflinePageMock = vi.fn();
export const getOfflineSaveStatusMock = vi.fn();
export const cancelOfflineSaveMock = vi.fn();
export const validateLocalAppMock = vi.fn();
export const openLocalAppMock = vi.fn();
export const searchLocalAppMock = vi.fn();
export const getUploadDirectoryMock = vi.fn(async (_directory: string) => ({
  directory: '/run/media/deck/SD/攻略',
}));
export const zoomReaderMock = vi.fn(async (): Promise<void> => undefined);
export const setReaderMotionMock = vi.fn(async () => undefined);
export const scrollWebPageMock = vi.fn(async () => undefined);
export const releaseWebScrollMock = vi.fn(async () => undefined);
export const zoomWebPageMock = vi.fn(async () => ({ factor: 1 }));
export const sendWebSpaceMock = vi.fn(async (): Promise<void> => undefined);
export const toggleWebFullscreenMock = vi.fn(async (): Promise<void> => undefined);
export const getWebPageStateMock = vi.fn();
export const startUrlInputMock = vi.fn();
export const getUrlInputStatusMock = vi.fn();
export const cancelUrlInputMock = vi.fn(async () => undefined);
export const callable = vi.fn((route: string) => {
  const methods: Record<string, unknown> = {
    zoom_reader: zoomReaderMock,
    set_reader_motion: setReaderMotionMock,
    scroll_web_page: scrollWebPageMock,
    release_web_scroll: releaseWebScrollMock,
    zoom_web_page: zoomWebPageMock,
    send_web_space: sendWebSpaceMock,
    toggle_web_fullscreen: toggleWebFullscreenMock,
    get_web_page_state: getWebPageStateMock,
    prepare_local_file: prepareLocalFileMock,
    list_local_files: listLocalFilesMock,
    delete_local_file: deleteLocalFileMock,
    list_offline_collections: listOfflineCollectionsMock,
    open_offline_collection: openOfflineCollectionMock,
    delete_offline_collection: deleteOfflineCollectionMock,
    plan_storage_migration: planStorageMigrationMock,
    start_storage_migration: startStorageMigrationMock,
    get_storage_migration_status: getStorageMigrationStatusMock,
    cancel_storage_migration: cancelStorageMigrationMock,
    save_offline_page: saveOfflinePageMock,
    get_offline_save_status: getOfflineSaveStatusMock,
    cancel_offline_save: cancelOfflineSaveMock,
    validate_local_app: validateLocalAppMock,
    open_local_app: openLocalAppMock,
    search_local_app: searchLocalAppMock,
    get_upload_directory: getUploadDirectoryMock,
    start_url_input: startUrlInputMock,
    get_url_input_status: getUrlInputStatusMock,
    cancel_url_input: cancelUrlInputMock,
  };
  return methods[route];
});
