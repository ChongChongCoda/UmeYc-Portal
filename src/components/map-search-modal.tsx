import { DialogButton, ModalRootProps } from '@decky/ui';
import { useEffect, useState } from 'react';

import { useGlobalState } from '../hooks/global-state';
import { searchLocalApp } from '../lib/local-app';
import {
  cancelUrlInput,
  getUrlInputStatus,
  startUrlInput,
  UrlInputSession,
} from '../lib/phone-input';
import { ViewMode } from '../lib/util';
import { modalWithState } from './modal';
import { PanelDialog } from './panel-dialog';
import { QrCode } from './qr-code';

export const MapSearchModal = (props: ModalRootProps) => {
  const [{ url }, setGlobalState] = useGlobalState();
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<UrlInputSession | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    let sessionId: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const cancel = () => {
      if (sessionId) void cancelUrlInput(sessionId).catch(() => undefined);
    };
    const fail = (message: string) => {
      if (disposed) return;
      setError(message);
      setSession(null);
      cancel();
    };

    const poll = async () => {
      try {
        const result = await getUrlInputStatus(sessionId!);
        if (disposed) return;
        if (result.status === 'received') {
          if (!('text' in result)) {
            fail('收到的不是搜索内容，请刷新二维码后重试。');
            return;
          }
          const text = result.text.trim();
          if (!text) {
            fail('搜索内容为空，请刷新二维码后重试。');
            return;
          }
          try {
            await searchLocalApp(url, text);
          } catch (cause) {
            fail(`搜索失败：${String(cause)}`);
            return;
          }
          if (disposed) return;
          setGlobalState((state) => ({
            ...state,
            visible: true,
            viewMode: ViewMode.Sidebar,
          }));
          props.closeModal?.();
        } else if (result.status === 'expired') {
          fail('二维码已过期，请刷新后重新扫码。');
        } else {
          timer = setTimeout(() => void poll(), 1000);
        }
      } catch (cause) {
        fail(`接收搜索内容失败：${String(cause)}`);
      }
    };

    setSession(null);
    setError('');
    setGlobalState((state) => ({ ...state, visible: false }));
    void startUrlInput('', 'search').then(
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
  }, [attempt, url]);

  return (
    <PanelDialog
      {...props}
      strTitle="地图搜索"
      strOKButtonText="关闭"
      bAlertDialog
      onOK={() => props.closeModal?.()}
      onCancel={() => props.closeModal?.()}
    >
      <div style={{ textAlign: 'center', fontSize: 13 }}>
        <div>用手机扫描二维码，在手机上输入搜索内容；发送后会自动写入当前地图或物品页。</div>
        {session && <QrCode value={session.url} />}
        {!session && !error && <p role="status">正在生成二维码…</p>}
        {error && <p role="alert">{error}</p>}
        {session && (
          <div role="status" style={{ opacity: 0.7 }}>
            等待手机发送 · 二维码 5 分钟内有效
          </div>
        )}
        <div style={{ opacity: 0.65, fontSize: 12, marginTop: 8 }}>
          Steam Deck 内置输入框的候选词会被窗口遮挡，因此改用手机键盘输入。
        </div>
        <DialogButton
          disabled={!session && !error}
          onClick={() => setAttempt((value) => value + 1)}
          style={{ margin: '10px auto 0', minWidth: 160 }}
        >
          刷新二维码
        </DialogButton>
      </div>
    </PanelDialog>
  );
};

export const MapSearchModalWithState = modalWithState(MapSearchModal);
