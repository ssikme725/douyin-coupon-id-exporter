import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parseCouponResponse, buildXlsx } from './core.mjs';
import { collectCouponProducts, readSelectedCount } from './page-reader.mjs';

const source = (await fs.readFile(new URL('./popup.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const couponId = '9999999999999999999';
const allIds = Array.from({ length: 1001 }, (_, i) => String(8000000000000000000n + BigInt(i)));
async function exportFixture({ apiCount = 500, total = 1001, collected = allIds,
  collectionError, switched = false } = {}) {
  let onClick, blob, downloads = 0, requests = 0;
  const button = { addEventListener(_, callback) { onClick = callback; } };
  const status = { textContent: '', classList: { toggle() {} } };
  const url = `https://fxg.jinritemai.com/ffa/marketing/coupon/detail?id=${couponId}`;
  class TestURL extends URL {
    static createObjectURL(value) { blob = value; return 'blob:fixture'; }
  }
  const chrome = {
    tabs: {
      query: async () => [{ id: 1, url }],
      get: async () => ({ url: switched ? 'https://fxg.jinritemai.com/login/common' : url })
    },
    scripting: {
      executeScript: async ({ func }) => {
        requests++;
        if (requests === 1) return [{ result: {
          responseText: JSON.stringify({ code: 0, data: {
            coupon_meta_id: couponId, type_detail: JSON.stringify(allIds.slice(0, apiCount).map(product_id => ({ product_id })))
          } }),
          pageText: `已选数量 ${total} 个`
        } }];
        assert.equal(func, collectCouponProducts);
        if (collectionError) throw new Error(collectionError);
        return [{ result: { ids: collected, total } }];
      }
    }
  };
  vm.runInNewContext(source, {
    parseCouponResponse, buildXlsx, collectCouponProducts, readSelectedCount, chrome,
    URL: TestURL, Blob, setTimeout() {},
    document: {
      getElementById: id => id === 'export' ? button : status,
      body: { append() {} },
      createElement: () => ({ click() { downloads++; }, remove() {} })
    }
  });
  await onClick();
  assert.equal(button.disabled, false);
  return { status: status.textContent, blob, downloads, requests };
}
const partial = await exportFixture();
assert.equal(partial.requests, 2);
assert.equal(partial.downloads, 1);
assert.match(partial.status, /1001.*一致/);
const zipText = new TextDecoder().decode(await partial.blob.arrayBuffer());
assert.ok(zipText.includes(allIds.at(-1)));
const fast = await exportFixture({ apiCount: 1001 });
assert.equal(fast.requests, 1);
assert.equal(fast.downloads, 1);
const empty = await exportFixture({ apiCount: 0 });
assert.equal(empty.downloads, 1);
for (const args of [
  { collected: allIds.slice(0, 500) },
  { collected: [...allIds.slice(0, -1), allIds[0]] },
  { collectionError: '翻页超时' },
  { switched: true }
]) {
  const result = await exportFixture(args);
  assert.equal(result.downloads, 0);
  assert.equal(result.blob, undefined);
}
console.log('通过：接口仅返回 500 条时补全 1001 条；完整响应直接导出；空明细补取；失败或切换页面不下载。');
