// This is the read-only pagination endpoint used by the coupon detail page itself.
// Self-contained because chrome.scripting serializes the function into MAIN world.
export async function collectCouponScope(couponId, expectedTotal) {
  const size = 20;
  const ids = new Set(), rowKeys = new Set();
  let total = null, received = 0;
  const assertPage = () => {
    const url = new URL(location.href);
    if (url.hostname !== 'fxg.jinritemai.com' ||
        !url.pathname.includes('/marketing/coupon/detail') || url.searchParams.get('id') !== couponId) {
      throw new Error('优惠券页面已切换或登录已失效，请重新导出。');
    }
  };
  const readPage = async page => {
    assertPage();
    const params = new URLSearchParams({ page: String(page), size: String(size), coupon_meta_id: couponId,
      _bid: 'ecom_market_shop', appid: '1' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`/marketing/coupons/v1/shopcoupons/get_coupon_scope?${params}`, {
        credentials: 'include', signal: controller.signal
      });
      if (!response.ok) throw new Error(`商品分页请求失败（${response.status}），请稍后重试。`);
      const text = await response.text();
      const payload = JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
        token => /^-?\d{16,}$/.test(token) ? `"${token}"` : token));
      if (payload.code !== 0 || !Array.isArray(payload.data?.goods) ||
          !Number.isSafeInteger(payload.data.total) || payload.data.total < 1) {
        throw new Error('商品分页接口未返回有效列表，请确认已登录且优惠券包含指定商品。');
      }
      assertPage();
      return payload.data;
    } finally { clearTimeout(timer); }
  };
  for (let page = 1; ; page++) {
    const data = await readPage(page);
    if (total === null) total = data.total;
    if (data.total !== total || (expectedTotal !== null && total !== expectedTotal)) {
      throw new Error('商品总数与页面不一致或在导出期间变化，请刷新后重试。');
    }
    const expectedSize = Math.min(size, total - received);
    if (data.goods.length !== expectedSize) throw new Error('商品分页缺失或被截断，未生成不完整文件。');
    for (const item of data.goods) {
      const id = item.product_id;
      if (typeof id !== 'string' || !/^\d{16,20}$/.test(id)) throw new Error('商品 ID 格式异常。');
      const key = JSON.stringify([id, item.channel_type ?? 0, String(item.channel_id ?? 0)]);
      if (rowKeys.has(key)) throw new Error('商品分页返回了重复记录，未生成不完整文件。');
      rowKeys.add(key);
      ids.add(id);
    }
    received += data.goods.length;
    if (received === total) {
      // Re-read the first page to detect common mid-export list changes.
      const first = await readPage(1);
      if (first.total !== total || first.goods.length !== Math.min(size, total) ||
          first.goods.some(item => !rowKeys.has(JSON.stringify([
            item.product_id, item.channel_type ?? 0, String(item.channel_id ?? 0)
          ])))) throw new Error('商品列表在导出期间变化，请重新导出。');
      return { ids: [...ids], total, received };
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
}
