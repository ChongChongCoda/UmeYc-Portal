import { DialogButton, Focusable, ModalRootProps } from '@decky/ui';
import { PanelDialog } from './panel-dialog';
import { FaTrashAlt } from 'react-icons/fa';
import { useEffect, useState } from 'react';
import { useGlobalState } from '../hooks/global-state';
import { editableAddress, localPathFromUrl, prepareLocalFile } from '../lib/local-files';
import { getUrlHistory, historyLabel, removeUrl, URL_HISTORY_LIMIT } from '../lib/url-history';
import { modalWithState } from './modal';

export const UrlHistoryModal = (props: ModalRootProps) => {
  const [, setGlobalState] = useGlobalState();
  const [history, setHistory] = useState(() => getUrlHistory(localStorage));
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
    <PanelDialog
      {...props}
      strTitle={`浏览历史（最近 ${URL_HISTORY_LIMIT} 条）`}
      strOKButtonText="关闭"
      bAlertDialog
      onOK={() => props.closeModal?.()}
    >
      {history.length === 0 && <p>还没有浏览记录。</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {history.map((url, index) => (
          <Focusable key={url} flow-children="row" style={{ display: 'flex', gap: 8, minWidth: 0 }}>
            <DialogButton
              aria-label={`打开历史记录 ${index + 1}`}
              disabled={opening}
              onClick={() => void open(url)}
              style={{ flex: '1 1 0', minWidth: 0, textAlign: 'left', padding: '10px 12px' }}
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
                {historyLabel(localStorage, url)}
              </span>
            </DialogButton>
            <DialogButton
              aria-label={`删除历史记录 ${index + 1}`}
              disabled={opening}
              onClick={() => {
                if (removeUrl(localStorage, url)) {
                  setHistory(getUrlHistory(localStorage));
                  setError('');
                } else setError('无法删除历史记录，请重试。');
              }}
              style={{ flex: '0 0 40px', minWidth: 40, padding: 8 }}
            >
              <FaTrashAlt aria-hidden="true" size={18} />
            </DialogButton>
          </Focusable>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </PanelDialog>
  );
};

export const UrlHistoryModalWithState = modalWithState(UrlHistoryModal);
