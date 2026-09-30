import { parseCouponResponse, buildXlsx } from './core.mjs';

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
      return await response.text();
    }
  });
  if (typeof injection?.result !== 'string') throw new Error('未能读取优惠券数据，请确认已登录并刷新页面。');
  return { couponId, responseText: injection.result };
}

button.addEventListener('click', async () => {
  button.disabled = true;
  setStatus('正在读取优惠券商品…');
  try {
    const { couponId, responseText } = await readCouponFromCurrentPage();
    const coupon = parseCouponResponse(responseText, couponId);
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
    setStatus(`已导出 ${coupon.ids.length} 个商品 ID（去重后 ${new Set(coupon.ids).size} 个）。`);
  } catch (error) {
    setStatus(error?.message || '导出失败，请刷新优惠券页面后重试。', true);
  } finally {
    button.disabled = false;
  }
});
