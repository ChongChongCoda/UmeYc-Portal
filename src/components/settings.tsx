import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ToggleField,
  Field,
  DialogButton,
} from '@decky/ui';
import { useEffect } from 'react';

import { ViewMode } from '../lib/util';
import { historyLabel } from '../lib/url-history';
import { useGlobalState } from '../hooks/global-state';

export const Settings = () => {
  const [
    { viewMode, url, sidebarVideoSpace, rightStickFullscreen, pageTitle, pageTitleUrl },
    setGlobalState,
  ] = useGlobalState();

  useEffect(() => {
    setGlobalState((state) => ({
      ...state,
      visible: true,
      viewMode: ViewMode.Sidebar,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => setGlobalState((state) => ({ ...state, activePanel: 'files' }))}
          >
            本地文件
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <Field
            label="网页"
            childrenLayout="below"
            childrenContainerWidth="max"
            bottomSeparator="standard"
            focusable={false}
          >
            <DialogButton
              aria-label="编辑网页"
              style={{
                width: '100%',
                minWidth: 0,
                boxSizing: 'border-box',
                padding: '10px 12px',
                textAlign: 'left',
              }}
              onClick={() => setGlobalState((state) => ({ ...state, activePanel: 'url' }))}
            >
              <span
                title={
                  pageTitleUrl === url && pageTitle ? pageTitle : historyLabel(localStorage, url)
                }
                style={{
                  display: 'block',
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                }}
              >
                {pageTitleUrl === url && pageTitle && /^https?:\/\//i.test(url)
                  ? pageTitle
                  : historyLabel(localStorage, url)}
              </span>
            </DialogButton>
          </Field>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            bottomSeparator="standard"
            onClick={() => setGlobalState((state) => ({ ...state, activePanel: 'phone' }))}
          >
            扫码传送
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            按「…」显示或隐藏攻略；右摇杆滚动，自动记住本次阅读位置。
          </div>
        </PanelSectionRow>
        {/^https?:\/\//i.test(url) && (
          <>
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
            <PanelSectionRow>
              <ToggleField
                label="按下右摇杆切换视频全屏"
                checked={rightStickFullscreen === true}
                description="网页显示时按下 R3 发送 F，切换视频全屏；需网站支持 F 快捷键。"
                onChange={(checked) =>
                  setGlobalState((state) => ({ ...state, rightStickFullscreen: checked }))
                }
              />
            </PanelSectionRow>
          </>
        )}
        <PanelSectionRow>
          <ButtonItem
            bottomSeparator="none"
            layout="below"
            disabled={!url}
            onClick={() =>
              setGlobalState((state) => ({
                ...state,
                viewMode: state.viewMode === ViewMode.Closed ? ViewMode.Sidebar : ViewMode.Closed,
              }))
            }
          >
            {viewMode === ViewMode.Closed ? '打开' : '关闭'}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};
