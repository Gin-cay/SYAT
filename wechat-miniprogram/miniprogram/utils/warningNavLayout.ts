/**
 * 预警中心自定义导航栏布局：与小程序右上角胶囊（菜单按钮）对齐
 */

export interface WarningNavLayoutData {
  statusBarHeight: number;
  navBarHeight: number;
  totalNavHeight: number;
  menuTopInNav: number;
  menuHeight: number;
  langBtnRightPx: number;
}

const FALLBACK: WarningNavLayoutData = {
  statusBarHeight: 20,
  navBarHeight: 44,
  totalNavHeight: 64,
  menuTopInNav: 6,
  menuHeight: 32,
  langBtnRightPx: 8,
};

export function computeWarningNavLayout(): WarningNavLayoutData {
  try {
    const sys = wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = sys.statusBarHeight || 20;
    const gap = menu.top - statusBarHeight;
    const navBarHeight = menu.height + gap * 2;
    const totalNavHeight = statusBarHeight + navBarHeight;
    const menuTopInNav = menu.top - statusBarHeight;
    const langBtnRightPx = sys.windowWidth - menu.left + 8;
    return {
      statusBarHeight,
      navBarHeight,
      totalNavHeight,
      menuTopInNav,
      menuHeight: menu.height,
      langBtnRightPx,
    };
  } catch {
    return { ...FALLBACK };
  }
}
