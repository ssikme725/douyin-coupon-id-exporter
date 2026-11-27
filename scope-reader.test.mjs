import assert from 'node:assert/strict';
import vm from 'node:vm';
import { collectCouponScope } from './scope-reader.mjs';
import { readSelectedCount } from './core.mjs';

const couponId = '9999999999999999999';
function fixture({ count = 1001, changeTotal = false, repeatPage = false, missingRow = false,
  badId = false, httpFailure = false, loggedOut = false, navigate = false, changeFirst = false,
  channels = false, timeout = false, numericIds = false, missingLast = false, emptyFirst = false } = {}) {
  const ids = Array.from({ length: count }, (_, i) => String(8000000000000000000n + BigInt(i)));
  const goods = ids.map(product_id => ({ product_id, channel_type: 0, channel_id: 0 }));
  if (channels) goods[1] = { product_id: ids[0], channel_type: 1, channel_id: '7777777777777777777' };
  let calls = 0, aborted = false;
  const pages = [];
  const location = { href: `https://fxg.jinritemai.com/ffa/marketing/coupon/detail?id=${couponId}` };
  const context = {
    URL, URLSearchParams, location, AbortController,
    setTimeout(callback, ms) {
      if (ms === 80 || timeout) queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    fetch: async (url, options) => {
      calls++;
      const params = new URL(url, 'https://fxg.jinritemai.com').searchParams;
      const page = Number(params.get('page'));
      const size = Number(params.get('size'));
      pages.push(page);
      assert.equal(params.get('coupon_meta_id'), couponId);
      assert.equal(size, 20);
      assert.equal(options.credentials, 'include');
      if (timeout) return new Promise((_, reject) => options.signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('请求超时'));
      }, { once: true }));
      if (navigate && page === 2) location.href = 'https://fxg.jinritemai.com/login/common';
      let rows = goods.slice((page - 1) * size, page * size);
      if (repeatPage && page === 2) rows = goods.slice(0, size);
      if (missingRow && page === 2) rows = rows.slice(1);
      if (missingLast && page === Math.ceil(count / size)) rows = rows.slice(1);
      if (emptyFirst && page === 1) rows = [];
      if (badId && page === 2) rows[0] = { product_id: 'invalid' };
      if (changeFirst && page === 1 && calls > 1) rows[0] = { product_id: '8888888888888888888' };
      const data = { code: loggedOut ? 401 : 0, data: { total: count + (changeTotal && page === 2 ? 1 : 0), goods: rows } };
      let text = JSON.stringify(data);
      if (numericIds) text = text.replace(/"product_id":"(\d+)"/g, '"product_id":$1');
      return { ok: !httpFailure, status: httpFailure ? 429 : 200, text: async () => text };
    }
  };
  return {
    ids: channels ? [...new Set(goods.map(row => row.product_id))] : ids,
    pages, get aborted() { return aborted; },
    run: (expected = count, details = [], returnErrors = false) => vm.runInNewContext(
      `(${collectCouponScope.toString()})('${couponId}',${expected},${JSON.stringify(details)},${returnErrors})`, context)
  };
}

assert.equal(readSelectedCount('已选数量 1,001 个'), 1001);
assert.equal(readSelectedCount('已选数量：501个'), 501);
assert.equal(readSelectedCount('共 500 条'), null);
assert.equal(readSelectedCount('已选数量 501 个 已选数量 600 个'), null);
for (const count of [1, 500, 501, 1001, 4041, 5000]) {
  const test = fixture({ count });
  const result = await test.run();
  assert.deepEqual(Array.from(result.ids), test.ids);
  assert.equal(result.total, count);
  assert.equal(result.received, count);
  assert.equal(test.pages.length, Math.ceil(count / 20) + 1);
  assert.equal(test.pages.at(-1), 1);
}
for (const options of [{ channels: true }, { numericIds: true }]) {
  const test = fixture(options);
  assert.deepEqual(Array.from((await test.run()).ids), test.ids);
}
for (const [options, message] of [
  [{ changeTotal: true }, /总数/], [{ repeatPage: true }, /重复/], [{ missingRow: true }, /数量核对失败/],
  [{ badId: true }, /格式/], [{ httpFailure: true }, /429/], [{ loggedOut: true }, /有效列表/],
  [{ navigate: true }, /页面已切换/], [{ changeFirst: true }, /列表.*变化/]
]) await assert.rejects(fixture(options).run(), message);
await assert.rejects(fixture().run(500), /总数/);
const slow = fixture({ timeout: true });
await assert.rejects(slow.run(), /超时/);
assert.ok(slow.aborted);
for (const options of [{ missingRow: true }, { missingLast: true }, { emptyFirst: true }]) {
  const recover = fixture({ count: 661, ...options });
  const result = await recover.run(661, recover.ids);
  assert.deepEqual([...result.ids].sort(), recover.ids);
  assert.equal(result.verifiedRecords, 661);
  assert.ok(result.recoveredFromDetail > 0);
  assert.equal(result.received + result.recoveredFromDetail, 661);
}
const absent = fixture({ count: 661, missingLast: true });
await assert.rejects(absent.run(661, absent.ids.slice(0, 500)), /数量核对失败/);
const stale = fixture({ count: 661, missingRow: true });
await assert.rejects(stale.run(661, [...stale.ids, '8888888888888888888']), /数量核对失败/);
const complete = fixture({ count: 661 });
await assert.rejects(complete.run(661, ['8888888888888888888']), /商品差异/);
const error = await fixture({ missingRow: true }).run(1001, [], true);
assert.match(error.error, /分页 1000\/1001 条/);
console.log('通过：分页少返回1条或空页时仅在详情精确补齐后导出；无法补齐、超额或数据冲突仍拦截；注入错误可序列化。');
console.log('通过：1/500/501/1001/4041/5000 条接口分页、渠道去重、长整数精度、末页完整性、重复/缺页/总数变化/登录失效/超时/页面切换。');
