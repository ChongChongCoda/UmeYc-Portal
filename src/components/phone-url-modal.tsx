import { DialogButton, ModalRootProps } from '@decky/ui';
import { useEffect, useState } from 'react';
import { PanelDialog } from './panel-dialog';
import { FolderPicker } from './folder-picker';

import { useGlobalState } from '../hooks/global-state';
import {
  cancelUrlInput,
  getUrlInputStatus,
  startUrlInput,
  UrlInputSession,
  UPLOAD_DIRECTORY_KEY,
} from '../lib/phone-input';
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
        if (result.status === 'received') {
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

  if (pickingDirectory)
    return (
      <FolderPicker
        initial={directory || session?.upload_picker_directory || '/run/media'}
        onCancel={() => setPickingDirectory(false)}
        onChoose={(path) => {
          localStorage.setItem(UPLOAD_DIRECTORY_KEY, path);
          setDirectory(path);
          setPickingDirectory(false);
        }}
      />
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
            disabled={pickingDirectory || uploading}
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
                : directory || session?.upload_directory || '自动选择（优先 SD 卡）'}
            </span>
          </DialogButton>
          {directory ? (
            <DialogButton
              disabled={uploading}
              onClick={() => {
                localStorage.removeItem(UPLOAD_DIRECTORY_KEY);
                setDirectory('');
              }}
              style={{ width: '100%', marginTop: 6 }}
            >
              恢复自动选择（优先 SD 卡）
            </DialogButton>
          ) : (
            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
              自动选择：有 SD 卡时使用 SD 卡，否则使用内置存储。
            </div>
          )}
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
