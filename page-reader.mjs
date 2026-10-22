// Self-contained: Chrome serializes this function before running it in the tab.
// Use the page's own pagination instead of guessing undocumented API parameters.
export async function collectCouponProducts(couponId) {
  if (globalThis.__douyinCouponExportActive) throw new Error('当前页面已有导出任务，请等待分页结束后再试。');
  globalThis.__douyinCouponExportActive = true;
  try {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const visible = element => element && element.getClientRects().length > 0;
    const assertPage = () => {
      const url = new URL(location.href);
      if (url.hostname !== 'fxg.jinritemai.com' ||
          !url.pathname.includes('/marketing/coupon/detail') ||
          url.searchParams.get('id') !== couponId) {
        throw new Error('优惠券页面已切换或登录已失效，请重新打开原优惠券后导出。');
      }
    };
    const readIds = table => [...table.querySelectorAll('tbody tr[data-row-key]')]
      .map(row => row.getAttribute('data-row-key')?.match(/^(\d{16,20})(?:_|$)/)?.[1])
      .filter(Boolean);
    const readCount = text => {
      const values = [...text.matchAll(/已选数量\s*[:：]?\s*([\d,，]+)\s*个?/g)]
        .map(match => Number(match[1].replace(/[,，]/g, '')));
      const unique = [...new Set(values)];
      if (unique.length !== 1 || !Number.isSafeInteger(unique[0]) || unique[0] < 1) {
        throw new Error('无法确认“已选数量”，已停止导出。请展开指定商品列表后重试。');
      }
      return unique[0];
    };
    const snapshot = () => {
      assertPage();
      const tables = [...document.querySelectorAll('table')].filter(table => visible(table) && readIds(table).length);
      if (tables.length !== 1) throw Object.assign(
        new Error('无法唯一识别优惠券商品表格，请展开指定商品列表后重试。'), { retryable: tables.length === 0 });
      const table = tables[0];
      let scope = table.parentElement;
      while (scope && !/已选数量/.test(scope.innerText)) scope = scope.parentElement;
      if (!scope) throw new Error('未找到商品列表的“已选数量”，已停止导出。');
      const total = readCount(scope.innerText);
      const pagers = [...scope.querySelectorAll('[class*="pagination"]')].filter(element =>
        visible(element) && /(?:^|\s)[\w-]*pagination(?:\s|$)/.test(element.className));
      const pager = pagers.filter(element => !pagers.some(other => other !== element && other.contains(element)));
      if (pager.length > 1) throw new Error('发现多个分页控件，无法确认优惠券商品分页。');
      const pagination = pager[0];
      const active = pagination?.querySelector('[aria-current="page"], [class*="item-active"], [class*="item-selected"]');
      const pageNumber = active ? Number(active.textContent.trim()) : NaN;
      const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : null;
      const ids = readIds(table);
      const loading = [...scope.querySelectorAll('[aria-busy="true"], [class*="spin-spinning"], [class*="loading-mask"]')].some(visible);
      return { total, pagination, page, ids, signature: ids.join(','), loading };
    };
    const disabled = element => !element || element.disabled || element.hasAttribute('disabled') ||
      element.getAttribute('aria-disabled') === 'true' || /disabled/.test(element.className) ||
      element.querySelector('button:disabled, [aria-disabled="true"]');
    const control = (state, direction) => {
      if (!state.pagination) return null;
      return state.pagination.querySelector(`[class*="pagination-${direction}"]`) ||
        [...state.pagination.querySelectorAll('button, li, a, [role="button"]')].find(element =>
          (direction === 'prev' ? /上一页|previous/i : /下一页|next/i)
            .test(`${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''} ${element.textContent}`));
    };
    const waitForPage = async (before, expectedPage) => {
      const deadline = Date.now() + 15000;
      let lastSignature = '', stable = 0;
      while (Date.now() < deadline) {
        await pause(200);
        let after;
        try { after = snapshot(); } catch (error) {
          if (error.retryable) continue;
          throw error;
        }
        if (after.total !== before.total) throw new Error('商品数量在导出过程中发生变化，请重新导出。');
        // Some pagers update the active number before the rows arrive.
        if (!after.loading && after.signature !== before.signature &&
            (expectedPage === null || after.page === expectedPage)) {
          stable = after.signature === lastSignature ? stable + 1 : 1;
          lastSignature = after.signature;
          if (stable >= 3) return after;
        } else stable = 0;
      }
      throw new Error('翻页超时或商品列表未更新，已停止导出，未生成不完整文件。');
    };
    const move = async (state, direction) => {
      const target = control(state, direction);
      if (!visible(target) || disabled(target)) return null;
      const expected = state.page === null ? null : state.page + (direction === 'next' ? 1 : -1);
      target.click();
      return waitForPage(state, expected);
    };

    let state = snapshot();
    const visitedBackwards = new Set();
    // Users may start an export on any page. Always collect from the first page.
    while (state.page !== 1) {
      if (visitedBackwards.has(state.signature)) throw new Error('分页重复，无法返回第一页。');
      visitedBackwards.add(state.signature);
      const previous = await move(state, 'prev');
      if (!previous) {
        if (state.page !== null && state.page !== 1) throw new Error('无法返回商品列表第一页。');
        break;
      }
      state = previous;
    }
    const ids = new Set(), visited = new Set();
    for (;;) {
      if (state.loading) throw new Error('商品列表正在加载，请加载完成后重新导出。');
      if (visited.has(state.signature)) throw new Error('商品列表重复，已停止导出。');
      visited.add(state.signature);
      state.ids.forEach(id => ids.add(id));
      if (ids.size > state.total) throw new Error('读取数量超过页面已选数量，请刷新后重试。');
      const next = control(state, 'next');
      if (ids.size === state.total) {
        if (visible(next) && !disabled(next)) throw new Error('数量已达到总数，但页面仍有下一页，请刷新后重试。');
        return { ids: [...ids], total: state.total };
      }
      const after = await move(state, 'next');
      if (!after) throw new Error(`只读取到 ${ids.size}/${state.total} 个商品，未生成不完整文件。`);
      state = after;
    }
  } finally {
    delete globalThis.__douyinCouponExportActive;
  }
}

export function readSelectedCount(text) {
  const counts = [...String(text).matchAll(/已选数量\s*[:：]?\s*([\d,，]+)\s*个?/g)]
    .map(match => Number(match[1].replace(/[,，]/g, '')));
  const unique = [...new Set(counts)];
  return unique.length === 1 && Number.isSafeInteger(unique[0]) && unique[0] > 0 ? unique[0] : null;
}
