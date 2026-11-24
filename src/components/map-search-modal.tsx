import { DialogButton, ModalRootProps } from '@decky/ui';
import { useEffect, useRef, useState } from 'react';

import { useGlobalState } from '../hooks/global-state';
import { searchLocalApp } from '../lib/local-app';
import {
  cancelUrlInput,
  getUrlInputStatus,
  startUrlInput,
  UrlInputSession,
} from '../lib/phone-input';
import {
  getVirtualKeyboardManager,
  SteamKeyboardRef,
  SteamVirtualKeyboardManager,
} from '../lib/steam-keyboard';
import { ViewMode } from '../lib/util';
import { modalWithState } from './modal';
import { PanelDialog } from './panel-dialog';
import { QrCode } from './qr-code';

type SearchDialogProps = ModalRootProps & {
  onPhoneFallback?: () => void;
};

const appendText = (current: string, chunk: string): string =>
  Array.from(current + chunk).slice(0, 200).join('');

/**
 * Search through Steam's own on-screen keyboard. Instead of typing into a
 * focused input (which loses IME candidates in the floating browser), every
 * committed key/candidate is received by `onTextEntered` and kept here.
 * The panel is replaced by a small top strip while the keyboard is open so
 * the keyboard's candidate row is never covered.
 */
const SteamKeyboardSearch = ({
  manager,
  closeModal,
  onPhoneFallback,
}: SearchDialogProps & { manager: SteamVirtualKeyboardManager }) => {
  const [{ url }, setGlobalState] = useGlobalState();
  const [text, setText] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const mounted = useRef(true);
  const finished = useRef(false);
  const buffer = useRef('');
  const vkRef = useRef<SteamKeyboardRef | null>(null);
  const submitRef = useRef<() => void>(() => undefined);

  const finish = async (value: string) => {
    const query = value.trim();
    if (!query || finished.current) return;
    finished.current = true;
    setBusy(true);
    setError('');
    try {
      vkRef.current?.HideVirtualKeyboard();
    } catch {
      // The keyboard may already have been dismissed by the user.
    }
    setKeyboardOpen(false);
    try {
      await searchLocalApp(url, query);
      if (!mounted.current) return;
      setGlobalState((state) => ({
        ...state,
        visible: true,
        viewMode: ViewMode.Sidebar,
      }));
      closeModal?.();
    } catch (cause) {
      finished.current = false;
      if (!mounted.current) return;
      setBusy(false);
      setError(`搜索失败：${String(cause)}`);
    }
  };

  submitRef.current = () => void finish(buffer.current);

  useEffect(() => {
    mounted.current = true;
    setGlobalState((state) => ({ ...state, visible: false }));
    return () => {
      mounted.current = false;
      setGlobalState((state) => ({ ...state, visible: true }));
    };
    // Global state setters are recreated on render; this only brackets the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let ref: SteamKeyboardRef | undefined;
    try {
      ref = manager.CreateVirtualKeyboardRef({
        strEnterKeyLabel: '搜索',
        BIsElementValidForInput: () => true,
        onTextEntered: (chunk) => {
          if (!mounted.current) return;
          if (chunk === 'Enter' || chunk === 'VKDone') {
            submitRef.current();
            return;
          }
          if (chunk === 'Backspace') {
            buffer.current = Array.from(buffer.current).slice(0, -1).join('');
          } else if (
            chunk === 'Tab' ||
            chunk === 'VKClose' ||
            chunk === 'VKPaste' ||
            chunk.startsWith('Arrow')
          ) {
            return;
          } else if (chunk.length > 0) {
            buffer.current = appendText(buffer.current, chunk);
          } else {
            return;
          }
          setText(buffer.current);
        },
        onEnterKeyPress: () => {
          submitRef.current();
          return null;
        },
      });
      vkRef.current = ref;
      ref.SetAsCurrentVirtualKeyboardTarget();
      // Use the same non-modal keyboard that Steam's own text fields open.
      // The modal variant can render while staying invisible/black in the QAM.
      ref.ShowVirtualKeyboard();
      setError('');
      setKeyboardOpen(true);
      const verify = setTimeout(() => {
        try {
          if (ref?.BIsActive && !ref.BIsActive()) {
            setKeyboardOpen(false);
            setError(
              'Steam 键盘没有成功打开。请点「继续输入」重试，或改用手机扫码输入。',
            );
          }
        } catch {
          // Treat a manager that cannot answer as a failed open.
          setKeyboardOpen(false);
          setError('Steam 键盘没有成功打开，请改用手机扫码输入。');
        }
      }, 900);
      return () => {
        clearTimeout(verify);
        try {
          ref?.HideVirtualKeyboard();
        } catch {
          // The keyboard may already have been dismissed by the user.
        }
      };
    } catch (cause) {
      setError(`无法打开 Steam 键盘：${String(cause)}`);
    }
    return () => {
      try {
        ref?.HideVirtualKeyboard();
      } catch {
        // The keyboard may already have been dismissed by the user.
      }
    };
    // The keyboard is recreated only for an explicit retry or a URL change.
  }, [manager, attempt, url]);

  // Detect the keyboard being closed through its own hide button or B.
  useEffect(() => {
    if (!keyboardOpen || busy) return;
    const timer = setInterval(() => {
      try {
        const ref = vkRef.current;
        if (ref?.BIsActive && !ref.BIsActive()) setKeyboardOpen(false);
      } catch {
        // A Steam update can invalidate the manager; fall back to the dialog.
        setKeyboardOpen(false);
      }
    }, 350);
    return () => clearInterval(timer);
  }, [keyboardOpen, busy]);

  if (keyboardOpen) {
    return (
      <div
        aria-label="地图搜索输入"
        style={{
          position: 'absolute',
          zIndex: 8001,
          left: '50%',
          top: 8,
          transform: 'translateX(-50%)',
          width: '92%',
          maxWidth: 520,
          boxSizing: 'border-box',
          padding: '10px 12px',
          border: '1px solid #36404d',
          borderRadius: 10,
          background: '#101720',
          boxShadow: '0 4px 18px rgba(0, 0, 0, 0.45)',
          color: '#fff',
          font: '14px sans-serif',
          pointerEvents: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 8,
            width: '100%',
          }}
        >
          <div style={{ flex: '1 1 0', minWidth: 0, maxWidth: '100%' }}>
            <div style={{ opacity: 0.65, fontSize: 12 }}>地图搜索</div>
            <div
              style={{
                minHeight: 26,
                fontSize: 18,
                fontWeight: 600,
                wordBreak: 'break-word',
                whiteSpace: 'normal',
              }}
            >
              {text || '请使用屏幕键盘输入关键词'}
            </div>
          </div>
          <button
            type="button"
            aria-label="取消搜索"
            onClick={() => {
              try {
                vkRef.current?.HideVirtualKeyboard();
              } catch {
                // The keyboard may already be gone.
              }
              setKeyboardOpen(false);
            }}
            style={{
              flex: '0 0 72px',
              width: 72,
              height: 34,
              padding: 0,
              border: 0,
              borderRadius: 6,
              background: '#435268',
              color: '#fff',
              font: '14px sans-serif',
              alignSelf: 'flex-start',
            }}
          >
            取消
          </button>
        </div>
        <div style={{ opacity: 0.65, fontSize: 12, marginTop: 4 }}>
          输入完成后按键盘上的「搜索」；收起键盘可返回。
        </div>
      </div>
    );
  }

  return (
    <PanelDialog
      strTitle="地图搜索"
      strOKButtonText="搜索"
      strCancelButtonText="取消"
      bOKDisabled={busy || !text.trim()}
      bCancelDisabled={busy}
      onOK={() => void finish(text)}
      onCancel={() => closeModal?.()}
      closeModal={closeModal}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            minHeight: 42,
            padding: '10px 12px',
            border: '1px solid #36404d',
            borderRadius: 8,
            background: '#252b35',
            wordBreak: 'break-word',
          }}
        >
          {text || <span style={{ opacity: 0.6 }}>尚未输入</span>}
        </div>
        <div style={{ opacity: 0.7, fontSize: 12 }}>
          使用 Steam 屏幕键盘输入；中文候选词显示在键盘上方。输入完成后按键盘上的「搜索」。
        </div>
        <DialogButton
          disabled={busy}
          onClick={() => setAttempt((value) => value + 1)}
          style={{ width: '100%' }}
        >
          继续输入
        </DialogButton>
        {onPhoneFallback && (
          <DialogButton disabled={busy} onClick={onPhoneFallback} style={{ width: '100%' }}>
            改用手机扫码输入
          </DialogButton>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </PanelDialog>
  );
};

/** Fallback for runtimes where Steam's keyboard manager is unavailable. */
const PhoneSearchModal = ({ closeModal, hint }: ModalRootProps & { hint?: string }) => {
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
          closeModal?.();
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
      strTitle="地图搜索"
      strOKButtonText="关闭"
      bAlertDialog
      onOK={() => closeModal?.()}
      onCancel={() => closeModal?.()}
      closeModal={closeModal}
    >
      <div style={{ textAlign: 'center', fontSize: 13 }}>
        {hint && (
          <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6 }}>{hint}</div>
        )}
        <div>用手机扫描二维码，在手机上输入搜索内容；发送后会自动写入当前地图或物品页。</div>
        {session && <QrCode value={session.url} />}
        {!session && !error && <p role="status">正在生成二维码…</p>}
        {error && <p role="alert">{error}</p>}
        {session && (
          <div role="status" style={{ opacity: 0.7 }}>
            等待手机发送 · 二维码 5 分钟内有效
          </div>
        )}
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

export const MapSearchModal = (props: ModalRootProps) => {
  const [manager] = useState(getVirtualKeyboardManager);
  const [mode, setMode] = useState<'steam' | 'phone'>(manager ? 'steam' : 'phone');
  if (mode === 'steam' && manager) {
    return (
      <SteamKeyboardSearch
        {...props}
        manager={manager}
        onPhoneFallback={() => setMode('phone')}
      />
    );
  }
  return (
    <PhoneSearchModal
      {...props}
      hint={manager ? undefined : '未找到 Steam 键盘管理器，已改用手机输入。'}
    />
  );
};

export const MapSearchModalWithState = modalWithState(MapSearchModal);
