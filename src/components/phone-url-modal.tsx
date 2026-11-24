import { toaster } from '@decky/api';
import { DialogButton, ModalRootProps } from '@decky/ui';
import { useEffect, useRef, useState } from 'react';
import { PanelDialog } from './panel-dialog';
import { FolderPicker } from './folder-picker';
import { OFFLINE_AUTO_KEY, saveOfflinePage } from '../lib/offline';

import { useGlobalState } from '../hooks/global-state';
import {
  cancelUrlInput,
  getUploadDirectory,
  getUrlInputStatus,
  startUrlInput,
  UrlInputSession,
  UPLOAD_DIRECTORY_KEY,
} from '../lib/phone-input';
import {
  formatBytes,
  planStorageMigration,
  startStorageMigration,
  StorageMigrationPlan,
} from '../lib/storage-migration';
import { modalWithState } from './modal';
import { QrCode } from './qr-code';
import { ViewMode } from '../lib/util';

export const PhoneUrlModal = (props: ModalRootProps) => {
  const [, setGlobalState] = useGlobalState();
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<UrlInputSession | null>(null);
  const [error, setError] = useState('');
  const [directory, setDirectory] = useState(
    () => localStorage.getItem(UPLOAD_DIRECTORY_KEY) || '',
  );
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [checkingStorage, setCheckingStorage] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const [pendingStorage, setPendingStorage] = useState<{
    plan: StorageMigrationPlan;
    storeValue: string;
  } | null>(null);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    let sessionId: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const cancel = () => {
      if (sessionId) void cancelUrlInput(sessionId).catch(() => undefined);
    };
    const poll = async () => {
      try {
        const result = await getUrlInputStatus(sessionId!);
        if (disposed) return;
        if (result.status === 'received' && 'url' in result) {
          if (
            /^https?:\/\//i.test(result.url) &&
            localStorage.getItem(OFFLINE_AUTO_KEY) !== 'off'
          ) {
            void saveOfflinePage(result.url, '', localStorage.getItem(UPLOAD_DIRECTORY_KEY) || '')
              .then(() => {
                toaster.toast({
                  title: '已开始离线保存',
                  body: '可在「本地文件 → 离线网页」查看进度。',
                });
              })
              .catch((cause: unknown) => {
                toaster.toast({
                  title: '离线保存未开始',
                  body: String(cause),
                });
              });
          }
          setGlobalState((state) => ({
            ...state,
            url: result.url,
            visible: true,
            viewMode: ViewMode.Sidebar,
          }));
          props.closeModal?.();
        } else if (result.status === 'expired') {
          setError('二维码已过期，请刷新后重新扫码。');
          setSession(null);
          cancel();
        } else {
          setUploading(result.status === 'uploading');
          timer = setTimeout(() => void poll(), 1000);
        }
      } catch (cause) {
        if (disposed) return;
        setError(`接收内容失败：${String(cause)}`);
        setSession(null);
        cancel();
      }
    };

    setSession(null);
    setError('');
    setUploading(false);
    setGlobalState((state) => ({ ...state, visible: false }));
    void startUrlInput(directory).then(
      (result) => {
        sessionId = result.session_id;
        if (disposed) return cancel();
        setSession(result);
        void poll();
      },
      (cause) => {
        if (!disposed) setError(`无法生成二维码：${String(cause)}`);
      },
    );

    return () => {
      disposed = true;
      clearTimeout(timer);
      cancel();
      setGlobalState((state) => ({ ...state, visible: true }));
    };
    // Global state setters are recreated on render; a session only restarts on explicit refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, directory]);

  const applyStorage = (storeValue: string) => {
    if (storeValue) localStorage.setItem(UPLOAD_DIRECTORY_KEY, storeValue);
    else localStorage.removeItem(UPLOAD_DIRECTORY_KEY);
    setDirectory(storeValue);
    setStorageNotice('');
  };

  const chooseStorage = async (path: string, storeValue = path) => {
    setPickingDirectory(false);
    setStorageError('');
    setStorageNotice('');
    if (path === (directory || session?.upload_directory) && storeValue === directory) return;
    setCheckingStorage(true);
    try {
      let oldRoot = directory;
      if (!oldRoot) {
        const current = await getUploadDirectory(localStorage.getItem(UPLOAD_DIRECTORY_KEY) || '');
        oldRoot = current.directory;
      }
      if (oldRoot && oldRoot !== path) {
        const plan = await planStorageMigration(oldRoot, path);
        if (!mounted.current) return;
        if (plan.total > 0) {
          setPendingStorage({ plan, storeValue });
          return;
        }
      }
      if (!mounted.current) return;
      applyStorage(storeValue);
    } catch (cause) {
      if (mounted.current) setStorageError(`无法检查原保存位置：${String(cause)}`);
    } finally {
      if (mounted.current) setCheckingStorage(false);
    }
  };

  const chooseAutomaticStorage = async () => {
    setStorageError('');
    setCheckingStorage(true);
    try {
      const current = await getUploadDirectory('');
      if (!mounted.current) return;
      setCheckingStorage(false);
      await chooseStorage(current.directory, '');
    } catch (cause) {
      if (mounted.current) {
        setCheckingStorage(false);
        setStorageError(`无法获取自动保存位置：${String(cause)}`);
      }
    }
  };

  const beginStorageMigration = async () => {
    if (!pendingStorage || storageBusy) return;
    setStorageBusy(true);
    setStorageError('');
    try {
      await startStorageMigration(pendingStorage.plan.old, pendingStorage.plan.new);
      if (!mounted.current) return;
      applyStorage(pendingStorage.storeValue);
      setPendingStorage(null);
      setStorageNotice('已在后台开始迁移，可在「本地文件」中查看进度。');
    } catch (cause) {
      if (mounted.current) setStorageError(`无法开始迁移：${String(cause)}`);
    } finally {
      if (mounted.current) setStorageBusy(false);
    }
  };

  const keepOldStorage = () => {
    if (!pendingStorage) return;
    applyStorage(pendingStorage.storeValue);
    setPendingStorage(null);
  };

  if (pickingDirectory)
    return (
      <FolderPicker
        initial={directory || session?.upload_picker_directory || '/run/media'}
        onCancel={() => setPickingDirectory(false)}
        onChoose={(path) => void chooseStorage(path)}
      />
    );

  if (pendingStorage)
    return (
      <PanelDialog
        {...props}
        strTitle="更换保存位置"
        strOKButtonText="迁移并更换"
        strCancelButtonText="取消"
        bAlertDialog
        bOKDisabled={storageBusy}
        bCancelDisabled={storageBusy}
        onOK={() => void beginStorageMigration()}
        onCancel={() => setPendingStorage(null)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p>
            原保存位置有 {pendingStorage.plan.images} 张图片、
            {pendingStorage.plan.collections} 个离线网页（{formatBytes(pendingStorage.plan.bytes)}
            ）。
          </p>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            迁移在后台进行，可在「本地文件」查看进度；也可以只更换位置，旧文件留在原处。
          </p>
          <DialogButton disabled={storageBusy} onClick={keepOldStorage}>
            仅更换位置
          </DialogButton>
          {storageError && <p role="alert">{storageError}</p>}
        </div>
      </PanelDialog>
    );

  return (
    <PanelDialog
      {...props}
      strTitle="扫码传送"
      strOKButtonText="关闭"
      bAlertDialog
      onOK={() => props.closeModal?.()}
      onCancel={() => props.closeModal?.()}
    >
      <div style={{ textAlign: 'center', fontSize: 14 }}>
        <div>与 Deck 连接同一 Wi-Fi，扫码后发送网址或上传图片。</div>
        {session && <QrCode value={session.url} />}
        {!session && !error && <p role="status">正在生成二维码…</p>}
        {error && <p role="alert">{error}</p>}
        {session && (
          <div role="status" style={{ opacity: 0.7 }}>
            {uploading ? '正在接收图片…' : '等待接收 · 二维码 5 分钟内有效'}
          </div>
        )}
        <div style={{ marginTop: 12, textAlign: 'left' }}>
          <div style={{ marginBottom: 6 }}>图片保存位置</div>
          <DialogButton
            aria-label="选择图片保存位置"
            disabled={pickingDirectory || uploading || checkingStorage}
            onClick={() => setPickingDirectory(true)}
            style={{ width: '100%', minWidth: 0, padding: '8px 12px' }}
          >
            <span
              title={directory || session?.upload_directory}
              style={{
                display: 'block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {pickingDirectory
                ? '正在选择…'
                : checkingStorage
                  ? '正在检查原保存位置…'
                  : directory || session?.upload_directory || '自动选择（优先 SD 卡）'}
            </span>
          </DialogButton>
          {directory ? (
            <DialogButton
              disabled={uploading || checkingStorage}
              onClick={() => void chooseAutomaticStorage()}
              style={{ width: '100%', marginTop: 6 }}
            >
              恢复自动选择（优先 SD 卡）
            </DialogButton>
          ) : (
            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
              自动选择：有 SD 卡时使用 SD 卡，否则使用内置存储。
            </div>
          )}
          {storageNotice && (
            <div role="status" style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>
              {storageNotice}
            </div>
          )}
          {storageError && <p role="alert">{storageError}</p>}
        </div>
        <DialogButton
          disabled={!session && !error}
          onClick={() => setAttempt((value) => value + 1)}
          style={{ margin: '12px auto 0', minWidth: 160 }}
        >
          刷新二维码
        </DialogButton>
      </div>
    </PanelDialog>
  );
};

export const PhoneUrlModalWithState = modalWithState(PhoneUrlModal);
