import { ConfirmModal, DialogButton, ModalRootProps } from '@decky/ui';
import { useEffect, useState } from 'react';

import { useGlobalState } from '../hooks/global-state';
import {
  cancelUrlInput,
  getUrlInputStatus,
  startUrlInput,
  UrlInputSession,
} from '../lib/phone-input';
import { modalWithState } from './modal';
import { QrCode } from './qr-code';

export const PhoneUrlModal = (props: ModalRootProps) => {
  const [, setGlobalState] = useGlobalState();
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
    const poll = async () => {
      try {
        const result = await getUrlInputStatus(sessionId!);
        if (disposed) return;
        if (result.status === 'received') {
          setGlobalState((state) => ({ ...state, url: result.url, visible: true }));
          props.closeModal?.();
        } else if (result.status === 'expired') {
          setError('二维码已过期，请刷新后重新扫码。');
          setSession(null);
          cancel();
        } else {
          timer = setTimeout(() => void poll(), 1000);
        }
      } catch (cause) {
        if (disposed) return;
        setError(`接收网址失败：${String(cause)}`);
        setSession(null);
        cancel();
      }
    };

    setSession(null);
    setError('');
    setGlobalState((state) => ({ ...state, visible: false }));
    void startUrlInput().then(
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
  }, [attempt]);

  return (
    <ConfirmModal
      {...props}
      strTitle="扫码输入网址"
      strOKButtonText="关闭"
      bAlertDialog
      onOK={() => props.closeModal?.()}
      onCancel={() => props.closeModal?.()}
    >
      <div style={{ textAlign: 'center', fontSize: 14 }}>
        <div>与 Deck 连接同一 Wi-Fi，扫码后填写网址。</div>
        {session && <QrCode value={session.url} />}
        {!session && !error && <p role="status">正在生成二维码…</p>}
        {error && <p role="alert">{error}</p>}
        {session && <div style={{ opacity: 0.7 }}>等待接收网址 · 二维码 5 分钟内有效</div>}
        <DialogButton
          disabled={!session && !error}
          onClick={() => setAttempt((value) => value + 1)}
          style={{ margin: '12px auto 0', minWidth: 160 }}
        >
          刷新二维码
        </DialogButton>
      </div>
    </ConfirmModal>
  );
};

export const PhoneUrlModalWithState = modalWithState(PhoneUrlModal);
