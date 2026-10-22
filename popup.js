import { parseCouponResponse, buildXlsx, readSelectedCount } from './core.mjs';
import { collectCouponScope } from './scope-reader.mjs';

const button = document.getElementById('export');
const status = document.getElementById('status');
const setStatus = (message, error = false) => {
  status.textContent = message;
  status.classList.toggle('error', error);
};

async function readCouponFromCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab?.url || 'about:blank');
  const couponId = url.searchParams.get('id');
  if (url.hostname !== 'fxg.jinritemai.com' || !url.pathname.includes('/marketing/coupon/detail') || !/^\d+$/.test(couponId || '')) {
    throw new Error('请先打开抖店的优惠券详情页。');
  }
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    args: [couponId],
    func: async id => {
      const response = await fetch(`/marketing/coupons/v1/shopcoupons/${id}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`后台请求失败（${response.status}）`);
      return { responseText: await response.text(), pageText: document.body.innerText };
    }
  });
  if (typeof injection?.result?.responseText !== 'string') throw new Error('未能读取优惠券数据，请确认已登录并刷新页面。');
  return { couponId, tabId: tab.id, ...injection.result };
}

button.addEventListener('click', async () => {
  button.disabled = true;
  setStatus('正在读取优惠券商品…');
  try {
    const { couponId, tabId, responseText, pageText } = await readCouponFromCurrentPage();
    const coupon = parseCouponResponse(responseText, couponId, { allowMissingProducts: true });
    const total = readSelectedCount(pageText);
    if (total === null || coupon.ids.length !== total) {
      setStatus(`详情返回 ${coupon.ids.length} 个商品，正在分批读取完整列表，请保持弹窗打开…`);
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        args: [couponId, total],
        func: collectCouponScope
      });
      const collected = result?.result;
      if (!collected || !Array.isArray(collected.ids) ||
          collected.received !== collected.total || collected.total < 1 || !collected.ids.length ||
          collected.ids.some(id => typeof id !== 'string' || !/^\d{16,20}$/.test(id)) ||
          new Set(collected.ids).size !== collected.ids.length ||
          (total !== null && collected.total !== total) ||
          coupon.ids.some(id => !collected.ids.includes(id))) {
        throw new Error('完整商品列表核对失败，未生成不完整文件。请刷新页面后重试。');
      }
      coupon.ids = collected.ids;
    }
    // Do not download a result after the tab navigated to another coupon/login page.
    const currentTab = await chrome.tabs.get(tabId);
    const currentUrl = new URL(currentTab.url || 'about:blank');
    if (currentUrl.hostname !== 'fxg.jinritemai.com' ||
        !currentUrl.pathname.includes('/marketing/coupon/detail') ||
        currentUrl.searchParams.get('id') !== couponId) {
      throw new Error('优惠券页面已切换，请在原优惠券页面重新导出。');
    }
    const bytes = buildXlsx(coupon);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `抖音优惠券_${couponId}_商品ID_${coupon.ids.length}个.xlsx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
    setStatus(`已完整读取并导出 ${coupon.ids.length} 个去重商品 ID。`);
  } catch (error) {
    setStatus(error?.message || '导出失败，请刷新优惠券页面后重试。', true);
  } finally {
    button.disabled = false;
  }
});
