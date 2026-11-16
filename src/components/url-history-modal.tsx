import { ConfirmModal, DialogButton, ModalRootProps } from '@decky/ui';
import { useEffect, useState } from 'react';
import { useGlobalState } from '../hooks/global-state';
import {
  addressLabel,
  editableAddress,
  localPathFromUrl,
  prepareLocalFile,
} from '../lib/local-files';
import { getUrlHistory } from '../lib/url-history';
import { modalWithState } from './modal';

export const UrlHistoryModal = (props: ModalRootProps) => {
  const [, setGlobalState] = useGlobalState();
  const [history] = useState(() => getUrlHistory(localStorage));
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const [lifetime] = useState(() => ({ active: true }));

  useEffect(() => {
    lifetime.active = true;
    setGlobalState((state) => ({ ...state, visible: false }));
    return () => {
      lifetime.active = false;
      setGlobalState((state) => ({ ...state, visible: true }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (url: string) => {
    setOpening(true);
    setError('');
    try {
      const path = localPathFromUrl(url);
      if (path) await prepareLocalFile(path);
      if (!lifetime.active) return;
      setGlobalState((state) => ({ ...state, url, visible: true }));
      props.closeModal?.();
    } catch (cause) {
      if (lifetime.active) setError(`无法打开历史记录：${String(cause)}`);
    } finally {
      if (lifetime.active) setOpening(false);
    }
  };

  return (
    <ConfirmModal
      {...props}
      strTitle="浏览历史（最近 5 条）"
      strOKButtonText="关闭"
      bAlertDialog
      onOK={() => props.closeModal?.()}
    >
      {history.length === 0 && <p>还没有浏览记录。</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {history.map((url, index) => (
          <DialogButton
            key={url}
            aria-label={`打开历史记录 ${index + 1}`}
            disabled={opening}
            onClick={() => void open(url)}
            style={{ minWidth: 0, textAlign: 'left', padding: '10px 12px' }}
          >
            <span
              title={editableAddress(url)}
              style={{
                display: 'block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {addressLabel(url)}
            </span>
          </DialogButton>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </ConfirmModal>
  );
};

export const UrlHistoryModalWithState = modalWithState(UrlHistoryModal);
