import { FaTv } from 'react-icons/fa';
import { StateManager } from 'cotton-box';
import { quickAccessMenuClasses } from '@decky/ui';
import { definePlugin, routerHook } from '@decky/api';

import { destroyPortalBrowserView, PortalViewOuter } from './components/portal-view';
import { Settings } from './components/settings';
import { Position, ViewMode } from './lib/util';
import { State, GlobalContext } from './hooks/global-state';
import { getPersistedPortalState, PORTAL_STORAGE_KEY } from './lib/storage';
import { isLoopbackUrl } from './lib/local-app';
import { rememberUrl } from './lib/url-history';

export default definePlugin(() => {
  const defaultState: State = {
    viewMode: ViewMode.Closed,
    previousViewMode: ViewMode.Sidebar,
    visible: true,
    position: Position.TopRight,
    margin: 30,
    size: 1,
    url: 'https://netflix.com',
    controlBar: false,
    sidebarVideoSpace: false,
    rightStickFullscreen: false,
    collapsed: false,
  };

  const restored = getPersistedPortalState(localStorage);
  if (isLoopbackUrl(restored.url || '')) {
    // Session tokens do not survive a reload; reopen these from their lists.
    restored.url = '';
    restored.viewMode = ViewMode.Closed;
  }
  const state = new StateManager<State>({
    ...defaultState,
    ...restored,
  });

  let lastUrl: string | undefined;
  state.watch(
    ({ viewMode, position, margin, size, url, sidebarVideoSpace, rightStickFullscreen }) => {
      const loopback = isLoopbackUrl(url);
      localStorage.setItem(
        PORTAL_STORAGE_KEY,
        JSON.stringify({
          viewMode: loopback
            ? ViewMode.Closed
            : viewMode === ViewMode.Closed
              ? ViewMode.Closed
              : ViewMode.Sidebar,
          position,
          margin,
          size,
          url: loopback ? '' : url,
          sidebarVideoSpace,
          rightStickFullscreen,
        }),
      );
      if (!loopback && url !== lastUrl) {
        lastUrl = url;
        rememberUrl(localStorage, url);
      }
    },
  );

  routerHook.addGlobalComponent('Portal', () => {
    return (
      <GlobalContext.Provider value={state}>
        <PortalViewOuter />
      </GlobalContext.Provider>
    );
  });

  return {
    name: 'UmeYc-Portal',
    titleView: <div className={quickAccessMenuClasses.Title}>UmeYc-Portal</div>,
    icon: <FaTv />,
    content: (
      <GlobalContext.Provider value={state}>
        <Settings />
      </GlobalContext.Provider>
    ),
    onDismount() {
      // Unmounting through the router hook is not guaranteed to run React
      // cleanups (uninstall, reload, crash). Destroy the Steam-side view now.
      destroyPortalBrowserView();
      routerHook.removeGlobalComponent('Portal');
    },
  };
});
