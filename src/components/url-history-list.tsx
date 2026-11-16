import { DialogButton, Focusable } from '@decky/ui';
import { FaTrashAlt } from 'react-icons/fa';
import { useState } from 'react';
import { editableAddress } from '../lib/local-files';
import { getUrlHistory, historyLabel, removeUrl, URL_HISTORY_LIMIT } from '../lib/url-history';

export const UrlHistoryList = ({
  opening,
  onOpen,
}: {
  opening: boolean;
  onOpen(url: string): void;
}) => {
  const [history, setHistory] = useState(() => getUrlHistory(localStorage));
  const [error, setError] = useState('');
  return (
    <section aria-label="最近浏览">
      <div style={{ fontSize: 14, marginBottom: 10 }}>最近浏览（最多 {URL_HISTORY_LIMIT} 条）</div>
      {history.length === 0 && <p>还没有浏览记录。</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {history.map((url, index) => (
          <Focusable key={url} flow-children="row" style={{ display: 'flex', gap: 8, minWidth: 0 }}>
            <DialogButton
              aria-label={`打开历史记录 ${index + 1}`}
              disabled={opening}
              onClick={() => onOpen(url)}
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
    </section>
  );
};
