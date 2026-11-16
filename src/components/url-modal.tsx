import { TextField, ConfirmModal, ModalRootProps } from '@decky/ui';
import { useEffect, useState } from 'react';

import { modalWithState } from './modal';
import { useGlobalState } from '../hooks/global-state';
import { editableAddress } from '../lib/local-files';

export const UrlModal = (props: ModalRootProps) => {
  const [{ url }, setGlobalState] = useGlobalState();
  const [field, setField] = useState(() => editableAddress(url));

  useEffect(() => {
    setGlobalState((state) => ({
      ...state,
      visible: false,
    }));

    return () =>
      setGlobalState((state) => ({
        ...state,
        visible: true,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ConfirmModal
      {...props}
      strTitle="攻略网址或图片地址"
      strOKButtonText="确定"
      strCancelButtonText="取消"
      onOK={() => {
        setGlobalState((state) => ({
          ...state,
          visible: true,
          url: field,
        }));
      }}
      onCancel={() => {
        setGlobalState((state) => ({
          ...state,
          visible: true,
        }));
      }}
    >
      <TextField
        description="输入攻略网页或图片地址；SD 卡上的图片请使用「本地文件」"
        value={field}
        onChange={(e) => setField(e.target.value)}
      />
    </ConfirmModal>
  );
};

export const UrlModalWithState = modalWithState(UrlModal);
