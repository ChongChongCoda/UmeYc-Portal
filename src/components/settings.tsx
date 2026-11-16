import {
  PanelSection,
  PanelSectionRow,
  DropdownItem,
  SliderField,
  showModal,
  ButtonItem,
  ToggleField,
  Field,
  Focusable,
  DialogButton,
} from '@decky/ui';
import { openFilePicker, toaster } from '@decky/api';
import { useEffect, useState } from 'react';
import { FaEdit, FaHistory, FaQrcode } from 'react-icons/fa';

import { Position, ViewMode } from '../lib/util';
import { useGlobalState } from '../hooks/global-state';
import { UrlModalWithState } from './url-modal';
import { PhoneUrlModalWithState } from './phone-url-modal';
import { UrlHistoryModalWithState } from './url-history-modal';
import {
  LOCAL_FILE_EXTENSIONS,
  LOCAL_DIRECTORY_KEY,
  localPickerDirectory,
  prepareLocalFile,
  toLocalFileUrl,
  addressLabel,
  editableAddress,
} from '../lib/local-files';

export const Settings = () => {
  const [
    { viewMode, position, margin, url, size, controlBar, sidebarVideoSpace },
    setGlobalState,
    stateContext,
  ] = useGlobalState();

  const isMinimised = viewMode === ViewMode.Minimised;
  const showPipControls = viewMode === ViewMode.Picture || isMinimised;
  const [pickingFile, setPickingFile] = useState(false);

  const chooseLocalFile = async () => {
    setPickingFile(true);
    setGlobalState((state) => ({ ...state, visible: false }));
    try {
      const selection = await openFilePicker(
        0, // FileSelectionType.FILE (the SDK's ambient const enum cannot be emitted by Rollup)
        localPickerDirectory(url),
        true,
        true,
        undefined,
        LOCAL_FILE_EXTENSIONS,
        false,
        false,
      );
      const path = selection.realpath || selection.path;
      // Validate before replacing the current page; the browser resolves a fresh URL on reopen.
      await prepareLocalFile(path);
      localStorage.setItem(LOCAL_DIRECTORY_KEY, path.slice(0, path.lastIndexOf('/')) || '/');
      setGlobalState((state) => ({
        ...state,
        url: toLocalFileUrl(path),
        viewMode: state.viewMode === ViewMode.Closed ? ViewMode.Sidebar : state.viewMode,
        visible: true,
      }));
    } catch (error) {
      if (error !== 'User canceled') {
        toaster.toast({ title: '无法打开本地文件', body: String(error) });
      }
    } finally {
      setPickingFile(false);
      setGlobalState((state) => ({ ...state, visible: true }));
    }
  };

  useEffect(() => {
    setGlobalState((state) => ({
      ...state,
      visible: true,
      viewMode: state.viewMode === ViewMode.Closed ? ViewMode.Picture : state.viewMode,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const positionOptions = [
    { label: '左上', data: Position.TopLeft },
    { label: '上方', data: Position.Top },
    { label: '右上', data: Position.TopRight },
    { label: '右侧', data: Position.Right },
    { label: '右下', data: Position.BottomRight },
    { label: '下方', data: Position.Bottom },
    { label: '左下', data: Position.BottomLeft },
    { label: '左侧', data: Position.Left },
  ];

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={pickingFile} onClick={chooseLocalFile}>
            {pickingFile ? '正在选择…' : '本地文件'}
          </ButtonItem>
        </PanelSectionRow>
        {viewMode === ViewMode.Closed && (
          <>
            <PanelSectionRow>
              <ButtonItem
                bottomSeparator="none"
                layout="below"
                onClick={() =>
                  setGlobalState((state) => ({
                    ...state,
                    viewMode: ViewMode.Picture,
                  }))
                }
              >
                打开
              </ButtonItem>
            </PanelSectionRow>
          </>
        )}
        {viewMode !== ViewMode.Closed && (
          <>
            <PanelSectionRow>
              <Field
                label="网址"
                childrenLayout="below"
                childrenContainerWidth="max"
                focusable={false}
              >
                <Focusable
                  style={{ display: 'flex', gap: 8, width: '100%', minWidth: 0 }}
                  flow-children="row"
                >
                  <DialogButton
                    aria-label="编辑网址"
                    style={{ flex: '1 1 0', minWidth: 0, padding: '10px 12px' }}
                    onClick={() => showModal(<UrlModalWithState value={stateContext} />)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <FaEdit style={{ flexShrink: 0 }} />
                      <span
                        title={editableAddress(url)}
                        style={{
                          display: 'block',
                          minWidth: 0,
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                          overflow: 'hidden',
                        }}
                      >
                        {addressLabel(url)}
                      </span>
                    </div>
                  </DialogButton>
                  <DialogButton
                    aria-label="浏览历史"
                    style={{
                      flex: '0 0 36px',
                      minWidth: 36,
                      padding: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onClick={() => showModal(<UrlHistoryModalWithState value={stateContext} />)}
                  >
                    <FaHistory size={20} aria-hidden="true" />
                  </DialogButton>
                  <DialogButton
                    aria-label="扫码输入网址"
                    style={{
                      flex: '0 0 42px',
                      minWidth: 42,
                      padding: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    onClick={() => showModal(<PhoneUrlModalWithState value={stateContext} />)}
                  >
                    <FaQrcode size={22} aria-hidden="true" />
                  </DialogButton>
                </Focusable>
              </Field>
            </PanelSectionRow>
            <PanelSectionRow>
              <DropdownItem
                label="布局"
                selectedOption={isMinimised ? ViewMode.Picture : viewMode}
                rgOptions={[
                  { label: '悬浮小窗', data: ViewMode.Picture },
                  { label: '全屏', data: ViewMode.Expand },
                  { label: '随侧栏显示', data: ViewMode.Sidebar },
                ]}
                onChange={(option) =>
                  setGlobalState((state) => ({
                    ...state,
                    viewMode: option.data,
                    visible: true,
                  }))
                }
              />
            </PanelSectionRow>
            {viewMode === ViewMode.Sidebar && (
              <PanelSectionRow>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  按「…」显示或隐藏攻略；右摇杆滚动，自动记住本次阅读位置。
                </div>
              </PanelSectionRow>
            )}
            {viewMode === ViewMode.Sidebar && /^https?:\/\//i.test(url) && (
              <PanelSectionRow>
                <ToggleField
                  label="随侧栏播放/暂停"
                  checked={sidebarVideoSpace === true}
                  description="先暂停视频；展开后发空格继续，收起前发空格暂停。网页需支持空格快捷键。"
                  onChange={(checked) =>
                    setGlobalState((state) => ({ ...state, sidebarVideoSpace: checked }))
                  }
                />
              </PanelSectionRow>
            )}
            <PanelSectionRow>
              <ToggleField
                label="展开"
                disabled={isMinimised}
                description={isMinimised ? '最小化时无法展开，请先还原窗口' : undefined}
                checked={viewMode === ViewMode.Expand}
                onChange={(checked) => {
                  setGlobalState((state) => ({
                    ...state,
                    viewMode: checked ? ViewMode.Expand : ViewMode.Picture,
                  }));
                }}
              />
            </PanelSectionRow>
            {!isMinimised && (
              <PanelSectionRow>
                <ToggleField
                  label="控制栏"
                  checked={controlBar}
                  onChange={(checked) => {
                    setGlobalState((state) => ({
                      ...state,
                      controlBar: checked,
                    }));
                  }}
                />
              </PanelSectionRow>
            )}
          </>
        )}
        {showPipControls && (
          <>
            {isMinimised && (
              <PanelSectionRow>
                <div style={{ fontSize: 12, opacity: 0.6, padding: '0 0 8px' }}>
                  窗口已最小化，设置将在还原后生效。
                </div>
              </PanelSectionRow>
            )}
            <PanelSectionRow>
              <DropdownItem
                label="位置"
                selectedOption={position}
                rgOptions={positionOptions}
                onChange={(option) =>
                  setGlobalState((state) => ({
                    ...state,
                    visible: true,
                    position: option.data,
                  }))
                }
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <SliderField
                label="大小"
                value={size}
                onChange={(size) =>
                  setGlobalState((state) => ({
                    ...state,
                    size,
                    visible: true,
                  }))
                }
                min={0.7}
                max={1.3}
                step={0.15}
                notchCount={3}
                notchTicksVisible={true}
                notchLabels={[
                  { label: '小', notchIndex: 0, value: 0.7 },
                  { label: '中', notchIndex: 1, value: 1 },
                  { label: '大', notchIndex: 2, value: 1.3 },
                ]}
              />
            </PanelSectionRow>
            <PanelSectionRow>
              <SliderField
                label="边距"
                value={margin}
                onChange={(margin) =>
                  setGlobalState((state) => ({
                    ...state,
                    margin,
                    visible: true,
                  }))
                }
                min={0}
                max={60}
                step={15}
                notchCount={3}
                notchTicksVisible={true}
                notchLabels={[
                  { label: '小', notchIndex: 0, value: 0 },
                  { label: '中', notchIndex: 1, value: 30 },
                  { label: '大', notchIndex: 2, value: 60 },
                ]}
              />
            </PanelSectionRow>
          </>
        )}
        {viewMode !== ViewMode.Closed && (
          <>
            <PanelSectionRow>
              <ButtonItem
                bottomSeparator="none"
                layout="below"
                onClick={() =>
                  setGlobalState((state) => ({
                    ...state,
                    viewMode: ViewMode.Closed,
                  }))
                }
              >
                关闭
              </ButtonItem>
            </PanelSectionRow>
          </>
        )}
      </PanelSection>
    </>
  );
};
