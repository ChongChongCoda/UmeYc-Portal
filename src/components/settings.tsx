import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  ToggleField,
  Field,
  DialogButton,
} from '@decky/ui';
import { toaster } from '@decky/api';
import { useEffect, useRef, useState } from 'react';

import { ViewMode } from '../lib/util';
import { historyLabel } from '../lib/url-history';
import { OFFLINE_AUTO_KEY } from '../lib/offline';
import { isLocalAppUrl } from '../lib/local-app';
import { isMobileWebEnabled, setMobileWebEnabled, setWebMobileMode } from '../lib/web-mobile';
import {
  checkPluginUpdate,
  PendingUpdate,
  UPDATE_CHECK_AT_KEY,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_ERROR_KEY,
  UPDATE_READY_KEY,
} from '../lib/updates';
import { useGlobalState } from '../hooks/global-state';

export const Settings = () => {
  const [
    { viewMode, url, sidebarVideoSpace, rightStickFullscreen, pageTitle, pageTitleUrl },
    setGlobalState,
  ] = useGlobalState();
  const [offlineAuto, setOfflineAuto] = useState(
    () => localStorage.getItem(OFFLINE_AUTO_KEY) !== 'off',
  );
  const [mobileWeb, setMobileWeb] = useState(isMobileWebEnabled);
  const [updating, setUpdating] = useState(false);
  const [updateNotice, setUpdateNotice] = useState(() => {
    try {
      const raw = localStorage.getItem(UPDATE_READY_KEY);
      if (raw) {
        const pending = JSON.parse(raw) as PendingUpdate;
        if (pending.version && pending.path) {
          return `已下载 ${pending.version}：${pending.path}。请到 Decky 设置 → 从 ZIP 文件安装。`;
        }
      }
      const error = localStorage.getItem(UPDATE_ERROR_KEY);
      return error ? `上次更新检查失败：${error}` : '';
    } catch {
      return '';
    }
  });
  const updatingRef = useRef(false);
  const mountedRef = useRef(true);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runUpdateRef = useRef<(manual: boolean) => Promise<void>>(async () => undefined);

  const runUpdate = async (manual: boolean) => {
    if (manual && autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    if (updatingRef.current) return;
    updatingRef.current = true;
    if (mountedRef.current) setUpdating(true);
    if (manual) {
      toaster.toast({
        title: '正在检查更新',
        body: '若发现新版本，会把 ZIP 下载到 Downloads。',
      });
    }
    try {
      const result = await checkPluginUpdate();
      if (!mountedRef.current) return;
      if (result.status === 'error') {
        const message = result.message || '未知错误';
        localStorage.setItem(UPDATE_ERROR_KEY, message);
        setUpdateNotice(
          `更新检查失败：${message}${
            result.report ? `；详情见 ${result.report}` : ''
          }`,
        );
        toaster.toast({ title: '检查更新失败', body: message });
        return;
      }
      localStorage.removeItem(UPDATE_ERROR_KEY);
      if (result.status === 'downloaded' || result.status === 'ready') {
        const version = result.version || '新版本';
        const path = result.path || '/home/deck/Downloads/UmeYc-Portal.zip';
        localStorage.setItem(UPDATE_READY_KEY, JSON.stringify({ version, path }));
        setUpdateNotice(
          `已下载 ${version}：${path}。请到 Decky 设置 → 从 ZIP 文件安装。`,
        );
        if (manual || result.status === 'downloaded') {
          toaster.toast({
            title: result.status === 'downloaded' ? '更新已下载' : '更新包已就绪',
            body: `${version} 已保存在 Downloads；请到 Decky 设置安装 ZIP。`,
          });
        }
      } else {
        localStorage.removeItem(UPDATE_READY_KEY);
        setUpdateNotice(
          `当前已是最新版本${result.current ? `（${result.current}）` : ''}。`,
        );
        if (manual) {
          toaster.toast({ title: '已是最新版本', body: result.current || '' });
        }
      }
    } catch (error) {
      const message = String(error);
      if (mountedRef.current) {
        localStorage.setItem(UPDATE_ERROR_KEY, message);
        setUpdateNotice(`更新检查失败：${message}`);
      }
      if (manual) {
        toaster.toast({ title: '检查更新失败', body: message });
      }
    } finally {
      updatingRef.current = false;
      if (mountedRef.current) setUpdating(false);
    }
  };
  runUpdateRef.current = runUpdate;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(UPDATE_CHECK_AT_KEY) || 0);
    } catch {
      last = 0;
    }
    if (Number.isFinite(last) && last > 0 && Date.now() - last < UPDATE_CHECK_INTERVAL_MS) {
      return;
    }
    try {
      localStorage.setItem(UPDATE_CHECK_AT_KEY, String(Date.now()));
    } catch {
      // Storage is optional; still allow the check.
    }
    const timer = setTimeout(() => {
      autoTimerRef.current = null;
      void runUpdateRef.current(false);
    }, 400);
    autoTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      if (autoTimerRef.current === timer) autoTimerRef.current = null;
    };
  }, []);

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => setGlobalState((state) => ({ ...state, activePanel: 'files' }))}
          >
            本地文件与地图册
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
        {isLocalAppUrl(url) && (
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              bottomSeparator="standard"
              onClick={() => setGlobalState((state) => ({ ...state, activePanel: 'mapsearch' }))}
            >
              地图搜索
            </ButtonItem>
          </PanelSectionRow>
        )}
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
          <ButtonItem
            layout="below"
            bottomSeparator="standard"
            disabled={updating}
            onClick={() => void runUpdateRef.current(true)}
          >
            {updating ? '正在检查并下载更新…' : '检查并下载更新'}
          </ButtonItem>
        </PanelSectionRow>
        {updateNotice && (
          <PanelSectionRow>
            <div style={{ fontSize: 12, opacity: 0.75, wordBreak: 'break-word' }}>
              {updateNotice}
            </div>
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <ToggleField
            label="扫码后自动离线保存"
            checked={offlineAuto}
            description="收到网址后等页面加载完成，再保存到「本地文件 → 离线网页」；视频不会离线保存。"
            onChange={(checked) => {
              setOfflineAuto(checked);
              if (checked) localStorage.removeItem(OFFLINE_AUTO_KEY);
              else localStorage.setItem(OFFLINE_AUTO_KEY, 'off');
            }}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="手机版网页"
            checked={mobileWeb}
            description="向网站请求手机版页面，适合窄侧栏阅读；切换后当前网页会刷新一次。"
            onChange={(checked) => {
              setMobileWeb(checked);
              setMobileWebEnabled(checked);
              setGlobalState((state) => ({ ...state, mobileWeb: checked }));
              void setWebMobileMode(checked).catch((error: unknown) =>
                toaster.toast({ title: '切换手机版失败', body: String(error) }),
              );
            }}
          />
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
                activePanel: undefined,
                visible: true,
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
