import { callable } from '@decky/api';

export const MOBILE_WEB_KEY = 'portal.mobileWeb';

export const isMobileWebEnabled = (): boolean => {
  try {
    return localStorage.getItem(MOBILE_WEB_KEY) === 'on';
  } catch {
    return false;
  }
};

export const setMobileWebEnabled = (enabled: boolean): void => {
  try {
    if (enabled) localStorage.setItem(MOBILE_WEB_KEY, 'on');
    else localStorage.removeItem(MOBILE_WEB_KEY);
  } catch {
    // Storage can be unavailable during plugin teardown.
  }
};

export const setWebMobileMode = callable<[enabled: boolean], { mobile: boolean }>(
  'set_web_mobile_mode',
);
