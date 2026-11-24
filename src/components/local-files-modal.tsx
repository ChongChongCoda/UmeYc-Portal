import { DialogButton, Focusable, ModalRootProps } from '@decky/ui';
import { PanelDialog } from './panel-dialog';
import { FolderPicker } from './folder-picker';
import { useEffect, useRef, useState } from 'react';
import { FaFolder, FaGlobe, FaTrashAlt } from 'react-icons/fa';
import { useGlobalState } from '../hooks/global-state';
import {
  deleteLocalFile,
  listLocalFiles,
  localPathFromUrl,
  LOCAL_DIRECTORY_KEY,
  LocalEntry,
  LocalListing,
  prepareLocalFile,
  toLocalFileUrl,
} from '../lib/local-files';
import {
  cancelOfflineSave,
  deleteOfflineCollection,
  getOfflineSaveStatus,
  listOfflineCollections,
  OfflineCollection,
  OfflineSaveStatus,
  offlineStatusLabel,
  openOfflineCollection,
} from '../lib/offline';
import {
  LOCAL_APP_DIRECTORY_KEY,
  LOCAL_APP_ENTRY_KEY,
  LOCAL_APP_PAGES,
  openLocalApp,
  validateLocalApp,
} from '../lib/local-app';
import { remapUrlHistory, removeUrl } from '../lib/url-history';
import { ViewMode } from '../lib/util';
import { getUploadDirectory, UPLOAD_DIRECTORY_KEY } from '../lib/phone-input';
import {
  cancelStorageMigration,
  formatBytes,
  getStorageMigrationStatus,
  isOfflineCollectionUrl,
  planStorageMigration,
  startStorageMigration,
  StorageMigrationPlan,
  StorageMigrationStatus,
} from '../lib/storage-migration';
import { modalWithState } from './modal';

export const LocalFilesModal = (props: ModalRootProps) => {
  const [, setGlobalState] = useGlobalState();
  const [directory, setDirectory] = useState<string | null>(null);
  const [listing, setListing] = useState<LocalListing | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<LocalEntry | null>(null);
  const [pendingCollection, setPendingCollection] = useState<OfflineCollection | null>(null);
  const [collections, setCollections] = useState<OfflineCollection[]>([]);
  const [saveRoot, setSaveRoot] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<'browse' | 'save' | 'map' | null>(null);
  const [mapDirectory, setMapDirectory] = useState('');
  const [mapEntries, setMapEntries] = useState<string[]>([]);
  const [mapError, setMapError] = useState('');
  const [mapBusy, setMapBusy] = useState(false);
  const [migrationPlan, setMigrationPlan] = useState<StorageMigrationPlan | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<StorageMigrationStatus | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState('');
  const [saveStatus, setSaveStatus] = useState<OfflineSaveStatus | null>(null);
  const [lifetime] = useState(() => ({ active: true }));
  const openedCollectionUrls = useRef(new Map<string, string>());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRefreshRef = useRef('');

  useEffect(() => {
    lifetime.active = true;
    setGlobalState((state) => ({ ...state, visible: false }));
    return () => {
      lifetime.active = false;
      setGlobalState((state) => ({ ...state, visible: true }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const selected = directory
      ? Promise.resolve({ directory })
      : getUploadDirectory(localStorage.getItem(UPLOAD_DIRECTORY_KEY) || '');
    void selected
      .then((result) => listLocalFiles(result.directory))
      .then(
        (result) => {
          if (!active) return;
          setListing(result);
          localStorage.setItem(LOCAL_DIRECTORY_KEY, result.directory);
        },
        (cause) => {
          if (active) {
            setListing(null);
            setError(String(cause));
          }
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [directory, revision]);

  useEffect(() => {
    let active = true;
    void getUploadDirectory(localStorage.getItem(UPLOAD_DIRECTORY_KEY) || '')
      .then((root) => {
        if (active) setSaveRoot(root.directory);
        return listOfflineCollections(root.directory);
      })
      .then(
        (result) => {
          if (active) setCollections(result.entries);
        },
        () => {
          if (active) setCollections([]);
        },
      );
    return () => {
      active = false;
    };
  }, [revision]);

  useEffect(() => {
    let active = true;
    void getStorageMigrationStatus().then(
      (status) => {
        if (!active || !status || status.status !== 'running') return;
        setMigrating(true);
        setMigrationStatus(status);
        pollMigration();
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const status = await getOfflineSaveStatus();
        if (!active) return;
        setSaveStatus(status);
        if (status && status.status === 'running') {
          timer = setTimeout(() => void tick(), 1000);
          return;
        }
        if (
          status &&
          status.status === 'done' &&
          status.collection &&
          saveRefreshRef.current !== status.collection.id
        ) {
          saveRefreshRef.current = status.collection.id;
          setRevision((value) => value + 1);
        }
      } catch {
        // A failed status read must not break the file list.
      }
    };
    void tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(LOCAL_APP_DIRECTORY_KEY) || '';
    setMapDirectory(stored);
    if (!stored) {
      setMapEntries([]);
      setMapError('');
      return;
    }
    let active = true;
    void validateLocalApp(stored).then(
      (info) => {
        if (!active) return;
        setMapDirectory(info.directory);
        setMapEntries(info.entries);
        localStorage.setItem(LOCAL_APP_DIRECTORY_KEY, info.directory);
        setMapError('');
      },
      (cause) => {
        if (!active) return;
        setMapEntries([]);
        setMapError(`地图册不可用：${String(cause)}`);
      },
    );
    return () => {
      active = false;
    };
  }, [revision]);

  const open = async (entry: LocalEntry) => {
    if (entry.directory) return setDirectory(entry.path);
    setBusy(true);
    setError('');
    try {
      await prepareLocalFile(entry.path);
      if (!lifetime.active) return;
      setGlobalState((state) => ({
        ...state,
        url: toLocalFileUrl(entry.path),
        viewMode: ViewMode.Sidebar,
        visible: true,
      }));
      props.closeModal?.();
    } catch (cause) {
      if (lifetime.active) setError(`无法打开本地文件：${String(cause)}`);
    } finally {
      if (lifetime.active) setBusy(false);
    }
  };

  const remove = async () => {
    if (!pending?.delete_token) return;
    setBusy(true);
    setError('');
    try {
      const deleted = await deleteLocalFile(pending.delete_token);
      removeUrl(localStorage, toLocalFileUrl(deleted.path));
      if (!lifetime.active) return;
      setGlobalState((state) =>
        localPathFromUrl(state.url) === deleted.path
          ? {
              ...state,
              url: '',
              pageTitle: undefined,
              pageTitleUrl: undefined,
              viewMode: ViewMode.Closed,
            }
          : state,
      );
      setPending(null);
      setRevision((value) => value + 1);
    } catch (cause) {
      if (lifetime.active) setError(`无法删除文件：${String(cause)}`);
    } finally {
      if (lifetime.active) setBusy(false);
    }
  };

  const openCollection = async (collection: OfflineCollection) => {
    setBusy(true);
    setError('');
    try {
      const result = await openOfflineCollection(collection.open_token);
      if (!lifetime.active) return;
      openedCollectionUrls.current.set(collection.id, result.url);
      setGlobalState((state) => ({
        ...state,
        url: result.url,
        pageTitle: collection.title,
        pageTitleUrl: result.url,
        viewMode: ViewMode.Sidebar,
        visible: true,
      }));
      props.closeModal?.();
    } catch (cause) {
      if (lifetime.active) setError(`无法打开离线网页：${String(cause)}`);
    } finally {
      if (lifetime.active) setBusy(false);
    }
  };

  const removeCollection = async () => {
    if (!pendingCollection) return;
    setBusy(true);
    setError('');
    try {
      await deleteOfflineCollection(pendingCollection.delete_token);
      if (!lifetime.active) return;
      const opened = openedCollectionUrls.current.get(pendingCollection.id);
      if (opened) {
        openedCollectionUrls.current.delete(pendingCollection.id);
        setGlobalState((state) =>
          state.url === opened
            ? {
                ...state,
                url: '',
                pageTitle: undefined,
                pageTitleUrl: undefined,
                viewMode: ViewMode.Closed,
              }
            : state,
        );
      }
      setPendingCollection(null);
      setRevision((value) => value + 1);
    } catch (cause) {
      if (lifetime.active) setError(`无法删除离线网页：${String(cause)}`);
    } finally {
      if (lifetime.active) setBusy(false);
    }
  };

  function switchSaveRoot(status: StorageMigrationStatus) {
    if (!status.new) return;
    const mapping: Record<string, string> = {};
    for (const item of status.images) {
      mapping[toLocalFileUrl(item.from)] = toLocalFileUrl(item.to);
    }
    remapUrlHistory(localStorage, mapping);
    localStorage.setItem(UPLOAD_DIRECTORY_KEY, status.new);
    setSaveRoot(status.new);
    const localDirectory = localStorage.getItem(LOCAL_DIRECTORY_KEY);
    if (
      localDirectory &&
      status.old &&
      (localDirectory === status.old || localDirectory.startsWith(`${status.old}/`))
    ) {
      localStorage.setItem(
        LOCAL_DIRECTORY_KEY,
        status.new + localDirectory.slice(status.old.length),
      );
    }
    setDirectory((current) => {
      if (!current || !status.old) return current;
      if (current !== status.old && !current.startsWith(`${status.old}/`)) return current;
      return status.new + current.slice(status.old.length);
    });
    setGlobalState((state) => {
      const moved = mapping[state.url];
      if (moved) return { ...state, url: moved };
      if (isOfflineCollectionUrl(state.url) && status.collections.length > 0) {
        return {
          ...state,
          url: '',
          pageTitle: undefined,
          pageTitleUrl: undefined,
          viewMode: ViewMode.Closed,
        };
      }
      return state;
    });
    setRevision((value) => value + 1);
  }

  function finishMigration(status: StorageMigrationStatus | null) {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
    setMigrating(false);
    if (!status) return;
    setMigrationStatus(status);
    if (status.status === 'done' || status.done_items > 0) {
      switchSaveRoot(status);
    }
  }

  function pollMigration() {
    const tick = async () => {
      if (!lifetime.active) return;
      try {
        const status = await getStorageMigrationStatus();
        if (!lifetime.active) return;
        setMigrationStatus(status);
        if (status && status.status === 'running') {
          pollTimer.current = setTimeout(() => void tick(), 500);
        } else {
          finishMigration(status);
        }
      } catch (cause) {
        if (lifetime.active) {
          setMigrating(false);
          setMigrationError(`读取迁移进度失败：${String(cause)}`);
        }
      }
    };
    void tick();
  }

  const beginMigration = async () => {
    if (!migrationPlan || migrating) return;
    setBusy(true);
    setMigrationError('');
    try {
      const result = await startStorageMigration(migrationPlan.old, migrationPlan.new);
      if (!lifetime.active) return;
      if (!result.started) {
        localStorage.setItem(UPLOAD_DIRECTORY_KEY, result.plan.new);
        setSaveRoot(result.plan.new);
        setMigrationPlan(null);
        setRevision((value) => value + 1);
        return;
      }
      setMigrating(true);
      setMigrationPlan(null);
      setMigrationStatus(result.status);
      pollMigration();
    } catch (cause) {
      if (lifetime.active) setMigrationError(`无法开始迁移：${String(cause)}`);
    } finally {
      if (lifetime.active) setBusy(false);
    }
  };

  const keepOldFiles = () => {
    if (!migrationPlan) return;
    localStorage.setItem(UPLOAD_DIRECTORY_KEY, migrationPlan.new);
    setSaveRoot(migrationPlan.new);
    setMigrationPlan(null);
    setRevision((value) => value + 1);
  };

  const changeSaveLocation = async (path: string) => {
    setPickerMode(null);
    setMigrationError('');
    if (saveRoot && path === saveRoot) return;
    if (!saveRoot) {
      localStorage.setItem(UPLOAD_DIRECTORY_KEY, path);
      setSaveRoot(path);
      setRevision((value) => value + 1);
      return;
    }
    setBusy(true);
    try {
      const plan = await planStorageMigration(saveRoot, path);
      if (!lifetime.active) return;
      if (plan.total === 0) {
        localStorage.setItem(UPLOAD_DIRECTORY_KEY, plan.new);
        setSaveRoot(plan.new);
        setRevision((value) => value + 1);
        return;
      }
      setMigrationPlan(plan);
      setMigrationStatus(null);
    } catch (cause) {
      if (lifetime.active) setMigrationError(`无法检查原保存位置：${String(cause)}`);
    } finally {
      if (lifetime.active) setBusy(false);
    }
  };

  const retryMigration = async () => {
    if (!migrationStatus) return;
    setBusy(true);
    setMigrationError('');
    try {
      const result = await startStorageMigration(migrationStatus.old, migrationStatus.new);
      if (!lifetime.active) return;
      if (!result.started) {
        finishMigration({ ...migrationStatus, status: 'done', errors: [] });
        return;
      }
      setMigrating(true);
      setMigrationStatus(result.status);
      pollMigration();
    } catch (cause) {
      if (lifetime.active) setMigrationError(`无法继续迁移：${String(cause)}`);
    } finally {
      if (lifetime.active) setBusy(false);
    }
  };

  const dismissMigration = () => {
    setMigrationPlan(null);
    setMigrationStatus(null);
    setMigrationError('');
  };

  const cancelMigration = async () => {
    try {
      const status = await cancelStorageMigration();
      if (lifetime.active && status) setMigrationStatus(status);
    } catch {
      // The next poll reports the real state.
    }
  };

  const cancelSave = async () => {
    try {
      const status = await cancelOfflineSave();
      if (lifetime.active && status) setSaveStatus(status);
    } catch {
      // The next poll reports the real state.
    }
  };

  const chooseMapDirectory = async (path: string) => {
    setPickerMode(null);
    setMapBusy(true);
    setMapError('');
    try {
      const info = await validateLocalApp(path);
      if (!lifetime.active) return;
      localStorage.setItem(LOCAL_APP_DIRECTORY_KEY, info.directory);
      setMapDirectory(info.directory);
      setMapEntries(info.entries);
    } catch (cause) {
      if (lifetime.active) setMapError(`地图册不可用：${String(cause)}`);
    } finally {
      if (lifetime.active) setMapBusy(false);
    }
  };

  const openMap = async (entry: string) => {
    const directory = mapDirectory || localStorage.getItem(LOCAL_APP_DIRECTORY_KEY) || '';
    if (!directory) {
      setMapError('请先选择地图册文件夹');
      return;
    }
    setMapBusy(true);
    setMapError('');
    try {
      const result = await openLocalApp(directory, entry);
      if (!lifetime.active) return;
      localStorage.setItem(LOCAL_APP_DIRECTORY_KEY, result.directory);
      localStorage.setItem(LOCAL_APP_ENTRY_KEY, entry);
      setMapDirectory(result.directory);
      setMapEntries(result.entries);
      setGlobalState((state) => ({
        ...state,
        url: result.url,
        pageTitle: '女王魔域离线地图册',
        pageTitleUrl: result.url,
        viewMode: ViewMode.Sidebar,
        visible: true,
      }));
      props.closeModal?.();
    } catch (cause) {
      if (lifetime.active) setMapError(`无法打开地图册：${String(cause)}`);
    } finally {
      if (lifetime.active) setMapBusy(false);
    }
  };

  const clearMap = () => {
    localStorage.removeItem(LOCAL_APP_DIRECTORY_KEY);
    localStorage.removeItem(LOCAL_APP_ENTRY_KEY);
    setMapDirectory('');
    setMapEntries([]);
    setMapError('');
  };

  if (pickerMode === 'browse')
    return (
      <FolderPicker
        initial={listing?.directory || '/run/media'}
        onCancel={() => setPickerMode(null)}
        onChoose={(path) => {
          setDirectory(path);
          setPickerMode(null);
        }}
      />
    );

  if (pickerMode === 'save')
    return (
      <FolderPicker
        initial={saveRoot || listing?.directory || '/run/media'}
        onCancel={() => setPickerMode(null)}
        onChoose={(path) => void changeSaveLocation(path)}
      />
    );

  if (pickerMode === 'map')
    return (
      <FolderPicker
        initial={mapDirectory || '/run/media'}
        onCancel={() => setPickerMode(null)}
        onChoose={(path) => void chooseMapDirectory(path)}
      />
    );

  return (
    <PanelDialog
      {...props}
      strTitle={pendingCollection ? '删除离线网页' : pending ? '删除本地文件' : '本地文件与地图册'}
      strOKButtonText={pendingCollection ? '删除网页' : pending ? '删除文件' : '关闭'}
      strCancelButtonText="取消"
      bAlertDialog={!pending && !pendingCollection}
      bOKDisabled={busy}
      bCancelDisabled={busy}
      onOK={() =>
        pendingCollection ? void removeCollection() : pending ? void remove() : props.closeModal?.()
      }
      onCancel={() =>
        pendingCollection
          ? setPendingCollection(null)
          : pending
            ? setPending(null)
            : props.closeModal?.()
      }
    >
      {pendingCollection ? (
        <div>
          <p>确定删除离线网页「{pendingCollection.title}」吗？删除后无法恢复。</p>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            共 {pendingCollection.pages} 页，包含的页面和图片会一起删除。
          </p>
        </div>
      ) : pending ? (
        <div>
          <p>确定删除「{pending.name}」吗？删除后无法恢复。</p>
          <p style={{ fontSize: 12, opacity: 0.7, overflowWrap: 'anywhere' }}>{pending.path}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>保存位置（图片与离线网页）</div>
            <Focusable flow-children="row" style={{ display: 'flex', gap: 8, minWidth: 0 }}>
              <div
                title={saveRoot || '自动选择（优先 SD 卡）'}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  alignSelf: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 13,
                }}
              >
                {saveRoot || '自动选择（优先 SD 卡）'}
              </div>
              <div style={{ flex: '0 0 72px' }}>
                <DialogButton
                  disabled={busy || migrating || loading}
                  onClick={() => setPickerMode('save')}
                  style={{ width: '100%', minWidth: 0, padding: '4px 2px', whiteSpace: 'nowrap' }}
                >
                  更换
                </DialogButton>
              </div>
            </Focusable>
          </div>
          {saveStatus && saveStatus.status === 'running' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                border: '1px solid rgba(80,160,255,0.45)',
                borderRadius: 8,
                padding: 10,
              }}
            >
              <div>正在离线保存：{saveStatus.title || saveStatus.url}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{saveStatus.message}</div>
              <DialogButton disabled={busy} onClick={() => void cancelSave()}>
                取消保存
              </DialogButton>
            </div>
          )}
          {saveStatus?.status === 'error' && <p role="alert">离线保存失败：{saveStatus.message}</p>}
          {saveStatus?.status === 'done' && saveStatus.collection && (
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              已保存离线网页「{saveStatus.collection.title}」
              {saveStatus.collection.link_pages
                ? `，包含 ${saveStatus.collection.link_pages} 个链接页面`
                : ''}
              。
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>离线地图册</div>
            <Focusable flow-children="row" style={{ display: 'flex', gap: 8, minWidth: 0 }}>
              <div
                title={mapDirectory || '未选择'}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  alignSelf: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 13,
                }}
              >
                {mapDirectory || '未选择（先解压到内置存储或 SD 卡）'}
              </div>
              {mapDirectory && (
                <div style={{ flex: '0 0 64px' }}>
                  <DialogButton
                    disabled={busy || mapBusy}
                    onClick={clearMap}
                    style={{ width: '100%', minWidth: 0, padding: '4px 2px', whiteSpace: 'nowrap' }}
                  >
                    清除
                  </DialogButton>
                </div>
              )}
            </Focusable>
            <DialogButton
              disabled={busy || mapBusy}
              onClick={() => setPickerMode('map')}
              style={{ width: '100%', minWidth: 0, padding: '8px 12px' }}
            >
              选择地图册文件夹
            </DialogButton>
            {mapEntries.length > 0 && (
              <Focusable flow-children="row" style={{ display: 'flex', gap: 8 }}>
                {LOCAL_APP_PAGES.filter((page) => mapEntries.includes(page.entry)).map((page) => (
                  <div key={page.entry} style={{ flex: '1 1 0', minWidth: 0 }}>
                    <DialogButton
                      disabled={busy || mapBusy}
                      onClick={() => void openMap(page.entry)}
                      style={{
                        width: '100%',
                        minWidth: 0,
                        padding: '8px 4px',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                      }}
                    >
                      {page.label}
                    </DialogButton>
                  </div>
                ))}
              </Focusable>
            )}
            {mapError && <p role="alert">{mapError}</p>}
            <div style={{ fontSize: 11, opacity: 0.6 }}>地图册只引用所选文件夹，不复制数据。</div>
          </div>
          {migrationPlan && !migrating && !migrationStatus && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 8,
                padding: 10,
              }}
            >
              <div>
                原保存位置有 {migrationPlan.images} 张图片、{migrationPlan.collections} 个离线网页（
                {formatBytes(migrationPlan.bytes)}）。
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                迁移到新位置；同名文件会自动编号，不会覆盖。也可以只更换位置，旧文件留在原处。
              </div>
              <Focusable flow-children="row" style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: '1 1 0', minWidth: 0 }}>
                  <DialogButton
                    disabled={busy}
                    onClick={() => void beginMigration()}
                    style={{ width: '100%', minWidth: 0, padding: '4px 2px' }}
                  >
                    迁移并更换
                  </DialogButton>
                </div>
                <div style={{ flex: '1 1 0', minWidth: 0 }}>
                  <DialogButton
                    disabled={busy}
                    onClick={keepOldFiles}
                    style={{ width: '100%', minWidth: 0, padding: '4px 2px' }}
                  >
                    仅更换
                  </DialogButton>
                </div>
                <div style={{ flex: '0 0 72px' }}>
                  <DialogButton
                    disabled={busy}
                    onClick={() => setMigrationPlan(null)}
                    style={{ width: '100%', minWidth: 0, padding: '4px 2px' }}
                  >
                    取消
                  </DialogButton>
                </div>
              </Focusable>
            </div>
          )}
          {(migrating || migrationStatus) && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 8,
                padding: 10,
              }}
            >
              {migrating ? (
                <>
                  <div>
                    正在迁移 {migrationStatus?.done_items ?? 0}/{migrationStatus?.total_items ?? 0}{' '}
                    · {formatBytes(migrationStatus?.bytes_done ?? 0)}/
                    {formatBytes(migrationStatus?.bytes_total ?? 0)}
                  </div>
                  {migrationStatus?.current && (
                    <div
                      style={{
                        fontSize: 12,
                        opacity: 0.7,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {migrationStatus.current}
                    </div>
                  )}
                  <div
                    style={{
                      height: 6,
                      background: 'rgba(255,255,255,0.15)',
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${
                          migrationStatus && migrationStatus.total_items > 0
                            ? Math.min(
                                100,
                                Math.round(
                                  (migrationStatus.done_items / migrationStatus.total_items) * 100,
                                ),
                              )
                            : 0
                        }%`,
                        background: '#1a9fff',
                      }}
                    />
                  </div>
                  <DialogButton disabled={busy} onClick={() => void cancelMigration()}>
                    取消迁移
                  </DialogButton>
                </>
              ) : (
                <>
                  <div>
                    {migrationStatus?.status === 'done'
                      ? `迁移完成：${migrationStatus.images.length} 张图片、${migrationStatus.collections.length} 个离线网页。`
                      : migrationStatus?.status === 'cancelled'
                        ? '迁移已取消。'
                        : '迁移结束。'}
                    {migrationStatus && migrationStatus.errors.length > 0
                      ? ` ${migrationStatus.errors.length} 项未迁移，仍留在原位置。`
                      : ''}
                  </div>
                  <Focusable flow-children="row" style={{ display: 'flex', gap: 8 }}>
                    {migrationStatus &&
                      (migrationStatus.status !== 'done' || migrationStatus.errors.length > 0) && (
                        <DialogButton
                          disabled={busy}
                          onClick={() => void retryMigration()}
                          style={{ flex: '1 1 0', minWidth: 0 }}
                        >
                          重试剩余项
                        </DialogButton>
                      )}
                    <DialogButton disabled={busy} onClick={dismissMigration}>
                      完成
                    </DialogButton>
                  </Focusable>
                  {migrationStatus && migrationStatus.errors.length > 0 && (
                    <div style={{ fontSize: 11, opacity: 0.7, maxHeight: 84, overflowY: 'auto' }}>
                      {migrationStatus.errors.map((error) => (
                        <div key={error.path} style={{ overflowWrap: 'anywhere' }}>
                          {error.path || '未知文件'}：{error.message}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {migrationError && <p role="alert">{migrationError}</p>}
          <Focusable flow-children="row" style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: '1 1 0', minWidth: 0 }}>
              <DialogButton
                onClick={() => setPickerMode('browse')}
                disabled={busy}
                style={{ width: '100%', minWidth: 0, whiteSpace: 'nowrap' }}
              >
                选择文件夹
              </DialogButton>
            </div>
            <div style={{ flex: '1 1 0', minWidth: 0 }}>
              <DialogButton
                onClick={() => setRevision((value) => value + 1)}
                disabled={busy || loading}
                style={{ width: '100%', minWidth: 0, whiteSpace: 'nowrap' }}
              >
                刷新
              </DialogButton>
            </div>
          </Focusable>
          <div style={{ fontSize: 12, opacity: 0.7, overflowWrap: 'anywhere' }}>
            {listing?.directory || directory}
          </div>
          {collections.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>离线网页</div>
              <div
                style={{
                  maxHeight: '24vh',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {collections.map((collection) => (
                  <Focusable
                    key={collection.id}
                    flow-children="row"
                    style={{ display: 'flex', gap: 8, minWidth: 0 }}
                  >
                    <DialogButton
                      aria-label={`打开离线网页 ${collection.title}`}
                      disabled={busy}
                      onClick={() => void openCollection(collection)}
                      style={{
                        flex: '1 1 0',
                        minWidth: 0,
                        textAlign: 'left',
                        padding: '10px 12px',
                      }}
                    >
                      <span
                        title={collection.title}
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <FaGlobe style={{ marginRight: 8 }} aria-hidden="true" />
                        {collection.title}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, opacity: 0.65 }}>
                        {collection.pages} 页 · {offlineStatusLabel(collection.status)}
                      </span>
                    </DialogButton>
                    <DialogButton
                      aria-label={`删除离线网页 ${collection.title}`}
                      disabled={busy}
                      onClick={() => {
                        setPending(null);
                        setPendingCollection(collection);
                        setError('');
                      }}
                      style={{ flex: '0 0 40px', minWidth: 40, padding: 8 }}
                    >
                      <FaTrashAlt size={18} aria-hidden="true" />
                    </DialogButton>
                  </Focusable>
                ))}
              </div>
            </div>
          )}
          {listing && listing.parent !== listing.directory && (
            <DialogButton disabled={busy || loading} onClick={() => setDirectory(listing.parent)}>
              上一级
            </DialogButton>
          )}
          {loading ? (
            <p role="status">正在读取文件…</p>
          ) : (
            <div
              style={{
                maxHeight: '42vh',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {listing?.entries.length === 0 && <p>此文件夹没有可打开的攻略文件。</p>}
              {listing?.entries.map((entry) => (
                <Focusable
                  key={entry.path}
                  flow-children="row"
                  style={{ display: 'flex', gap: 8, minWidth: 0 }}
                >
                  <DialogButton
                    aria-label={`打开${entry.directory ? '文件夹' : '文件'} ${entry.name}`}
                    disabled={busy}
                    onClick={() => void open(entry)}
                    style={{ flex: '1 1 0', minWidth: 0, textAlign: 'left', padding: '10px 12px' }}
                  >
                    <span
                      title={entry.name}
                      style={{
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.directory && (
                        <FaFolder style={{ marginRight: 8 }} aria-hidden="true" />
                      )}
                      {entry.name}
                    </span>
                  </DialogButton>
                  {!entry.directory && entry.delete_token && (
                    <DialogButton
                      aria-label={`删除文件 ${entry.name}`}
                      disabled={busy}
                      onClick={() => {
                        setPendingCollection(null);
                        setPending(entry);
                        setError('');
                      }}
                      style={{ flex: '0 0 40px', minWidth: 40, padding: 8 }}
                    >
                      <FaTrashAlt size={18} aria-hidden="true" />
                    </DialogButton>
                  )}
                </Focusable>
              ))}
              {listing?.truncated && <p>文件较多，仅显示前 500 项，请进入更具体的文件夹。</p>}
            </div>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </PanelDialog>
  );
};

export const LocalFilesModalWithState = modalWithState(LocalFilesModal);
