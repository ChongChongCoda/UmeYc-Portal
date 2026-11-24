import { TextField, ModalRootProps } from '@decky/ui';
import { useEffect, useState } from 'react';

import { useGlobalState } from '../hooks/global-state';
import { searchLocalApp } from '../lib/local-app';
import { ViewMode } from '../lib/util';
import { modalWithState } from './modal';
import { PanelDialog } from './panel-dialog';

export const MapSearchModal = (props: ModalRootProps) => {
  const [{ url }, setGlobalState] = useGlobalState();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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

  const submit = async () => {
    const text = query.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      await searchLocalApp(url, text);
      if (!lifetime.active) return;
      setGlobalState((state) => ({ ...state, visible: true, viewMode: ViewMode.Sidebar }));
      props.closeModal?.();
    } catch (cause) {
      if (lifetime.active) setError(`搜索失败：${String(cause)}`);
    } finally {
      if (lifetime.active) setBusy(false);
    }
  };

  return (
    <PanelDialog
      {...props}
      strTitle="地图搜索"
      strOKButtonText="搜索"
      strCancelButtonText="取消"
      bOKDisabled={busy || !query.trim()}
      onOK={() => void submit()}
      onCancel={() => props.closeModal?.()}
    >
      <TextField
        label="搜索内容"
        description="输入物品名称、说明、密码、点位或区域；结果会显示在地图页中。请先打开 2D/3D 地图或物品查询。"
        value={query}
        disabled={busy}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <p role="alert">{error}</p>}
    </PanelDialog>
  );
};

export const MapSearchModalWithState = modalWithState(MapSearchModal);
