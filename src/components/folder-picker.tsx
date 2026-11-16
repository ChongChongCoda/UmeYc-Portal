import { DialogButton, Focusable } from '@decky/ui';
import { useEffect, useState } from 'react';
import { listLocalFiles, LocalListing } from '../lib/local-files';
import { PanelDialog } from './panel-dialog';

export const FolderPicker = ({
  initial,
  onChoose,
  onCancel,
}: {
  initial: string;
  onChoose(path: string): void;
  onCancel(): void;
}) => {
  const [directory, setDirectory] = useState(initial);
  const [listing, setListing] = useState<LocalListing | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = (path: string) => {
    if (path === directory) return;
    setLoading(true);
    setError('');
    setListing(null);
    setDirectory(path);
  };
  useEffect(() => {
    let active = true;
    void listLocalFiles(directory)
      .then(
        (result) => {
          if (active) setListing(result);
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
  }, [directory]);
  return (
    <PanelDialog
      strTitle="选择文件夹"
      strOKButtonText="使用此文件夹"
      bOKDisabled={!listing || loading}
      onOK={() => listing && onChoose(listing.directory)}
      onCancel={onCancel}
    >
      <Focusable flow-children="row" style={{ display: 'flex', gap: 8 }}>
        <DialogButton style={{ flex: 1, minWidth: 0 }} onClick={() => navigate('/run/media')}>
          SD 卡
        </DialogButton>
        <DialogButton style={{ flex: 1, minWidth: 0 }} onClick={() => navigate('/home/deck')}>
          内置存储
        </DialogButton>
      </Focusable>
      <p style={{ overflowWrap: 'anywhere', fontSize: 12, opacity: 0.7 }}>
        {listing?.directory || directory}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {listing && listing.parent !== listing.directory && (
          <DialogButton disabled={loading} onClick={() => navigate(listing.parent)}>
            上一级
          </DialogButton>
        )}
        {loading ? (
          <p role="status">正在读取文件夹…</p>
        ) : (
          listing?.entries
            .filter((entry) => entry.directory)
            .map((entry) => (
              <DialogButton
                key={entry.path}
                onClick={() => navigate(entry.path)}
                style={{ minWidth: 0, textAlign: 'left' }}
              >
                {entry.name}
              </DialogButton>
            ))
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </PanelDialog>
  );
};
