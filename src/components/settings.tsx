import {
  PanelSection,
  PanelSectionRow,
  DropdownItem,
  SliderField,
  showModal,
  ButtonItem,
  ToggleField,
} from '@decky/ui';
import { openFilePicker, toaster } from '@decky/api';
import { useEffect, useState } from 'react';
import { FaEdit } from 'react-icons/fa';

import { Position, ViewMode } from '../lib/util';
import { useGlobalState } from '../hooks/global-state';
import { UrlModalWithState } from './url-modal';
import {
  LOCAL_FILE_EXTENSIONS,
  LOCAL_DIRECTORY_KEY,
  localPickerDirectory,
  prepareLocalFile,
  toLocalFileUrl,
} from '../lib/local-files';

export const Settings = () => {
  const [{ viewMode, position, margin, url, size, controlBar }, setGlobalState, stateContext] =
    useGlobalState();

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
        viewMode: ViewMode.Picture,
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
              <ButtonItem
                label="网址"
                layout="below"
                onClick={() => showModal(<UrlModalWithState value={stateContext} />)}
              >
                <div style={{ display: 'flex' }}>
                  <FaEdit />
                  &nbsp;&nbsp;
                  <div style={{ maxWidth: 180, textOverflow: 'ellipsis', overflow: 'hidden' }}>
                    {url}
                  </div>
                </div>
              </ButtonItem>
            </PanelSectionRow>
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
                onMenuOpened={() =>
                  setGlobalState((state) => ({
                    ...state,
                    visible: false,
                  }))
                }
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
