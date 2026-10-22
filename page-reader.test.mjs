import assert from 'node:assert/strict';
import vm from 'node:vm';
import { collectCouponProducts, readSelectedCount } from './page-reader.mjs';

const couponId = '9999999999999999999';
const makeIds = count => Array.from({ length: count }, (_, i) => String(8000000000000000000n + BigInt(i)));

// A page fixture with asynchronous pagination: the page number changes immediately,
// the rows disappear briefly, and the new data arrives several ticks later.
export function pageFixture({ count = 1001, pageSize = 20, startPage = 1,
  stalled = false, duplicate = false, wrongTotal = false, navigate = false, missingTail = false } = {}) {
  const expected = makeIds(count);
  const pages = Array.from({ length: Math.ceil(count / pageSize) }, (_, i) => expected.slice(i * pageSize, (i + 1) * pageSize));
  if (missingTail) pages.pop();
  let page = startPage, rowsPage = startPage, ticks = 0, now = 0, total = count;
  const clicks = [];
  const location = { href: `https://fxg.jinritemai.com/ffa/marketing/coupon/detail?id=${couponId}` };
  const visible = { getClientRects: () => [1] };
  const target = direction => ({
    ...visible,
    className: (direction === 'prev' ? page === 1 : page === pages.length) ? 'disabled' : '',
    getAttribute: () => null,
    hasAttribute: () => false,
    querySelector: () => null,
    click() {
      clicks.push([page, direction]);
      page += direction === 'next' ? 1 : -1;
      ticks = 3;
      if (wrongTotal) total++;
      if (navigate) location.href = 'https://fxg.jinritemai.com/login/common';
    }
  });
  const pager = {
    ...visible, className: 'ecom-pagination', contains: () => false,
    querySelector(selector) {
      if (selector.includes('aria-current')) return { textContent: String(page) };
      if (selector.includes('pagination-prev')) return target('prev');
      if (selector.includes('pagination-next')) return target('next');
      return null;
    }
  };
  const scope = {
    get innerText() { return `指定商品（商品券）\n已选数量 ${total} 个`; },
    querySelectorAll(selector) {
      if (selector.includes('pagination')) return [pager];
      if (selector.includes('aria-busy')) return ticks ? [visible] : [];
      return [];
    }
  };
  const table = {
    ...visible, parentElement: scope,
    querySelectorAll() {
      if (ticks === 2) return [];
      return pages[rowsPage - 1].map(id => ({ getAttribute: () => `${id}_0_0` }));
    }
  };
  const context = {
    URL, location, document: { querySelectorAll: () => [table] },
    Date: { now: () => now },
    setTimeout(callback, ms) {
      now += ms;
      if (ticks && !stalled) {
        ticks--;
        if (!ticks && !duplicate) rowsPage = page;
      }
      queueMicrotask(callback);
    }
  };
  const run = () => vm.runInNewContext(`(${collectCouponProducts.toString()})('${couponId}')`, context);
  return { expected, clicks, run };
}

assert.equal(readSelectedCount('已选数量 1,001 个'), 1001);
assert.equal(readSelectedCount('已选数量：501个'), 501);
assert.equal(readSelectedCount('共 500 条'), null);
assert.equal(readSelectedCount('已选数量 501 个 已选数量 600 个'), null);
for (const count of [500, 501, 1001, 5000]) {
  const fixture = pageFixture({ count });
  const result = await fixture.run();
  assert.deepEqual(Array.from(result.ids), fixture.expected);
  assert.equal(result.total, count);
  assert.equal(fixture.clicks.length, Math.ceil(count / 20) - 1);
}
const middle = pageFixture({ count: 521, startPage: 20 });
assert.deepEqual(Array.from((await middle.run()).ids), middle.expected);
assert.equal(middle.clicks[0][1], 'prev');
await assert.rejects(pageFixture({ stalled: true }).run(), /翻页超时/);
await assert.rejects(pageFixture({ duplicate: true }).run(), /翻页超时/);
await assert.rejects(pageFixture({ wrongTotal: true }).run(), /数量.*变化/);
await assert.rejects(pageFixture({ navigate: true }).run(), /页面已切换/);
await assert.rejects(pageFixture({ missingTail: true }).run(), /只读取到.*未生成不完整/);
const concurrent = pageFixture();
const running = concurrent.run();
await assert.rejects(concurrent.run(), /已有导出任务/);
await running;
console.log('通过：500/501/1001/5000 条分页、从中间页导出、异步行更新、重复页、超时、数量变化及页面切换。');
