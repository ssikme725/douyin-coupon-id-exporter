import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseCouponResponse, buildXlsx } from './core.mjs';

const ids = ['1234567890123456789', '9876543210987654321', '1111111111111111111'];
const couponId = '9999999999999999999';
const payload = JSON.stringify({ code: 0, data: {
  coupon_meta_id: couponId,
  coupon_name: '测试优惠券',
  type_detail: `[${ids.map(id => `{"product_id":${id},"channel_type":0}`).join(',')}]`
} });
const coupon = parseCouponResponse(payload, couponId);
assert.deepEqual(coupon.ids, ids);
assert.throws(() => parseCouponResponse(payload, '0000000000000000000'), /不一致/);
assert.deepEqual(parseCouponResponse(`{"code":0,"data":{"coupon_meta_id":${couponId},"type_detail":[{"product_id":${ids[0]}}]}}`, couponId).ids, [ids[0]]);
assert.deepEqual(parseCouponResponse(JSON.stringify({ code: 0, data: { coupon_meta_id: couponId } }), couponId,
  { allowMissingProducts: true }).ids, []);
assert.throws(() => parseCouponResponse(JSON.stringify({ code: 0, data: { coupon_meta_id: couponId } }), couponId), /没有可导出/);

// Inspect the actual worksheet in the uncompressed ZIP, not just the file size.
function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    files.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    offset = start + size;
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  return files;
}

for (const count of [500, 501, 1000, 5000]) {
  const expected = Array.from({ length: count }, (_, i) => String(8000000000000000000n + BigInt(i)));
  const result = parseCouponResponse(JSON.stringify({ code: 0, data: {
    coupon_meta_id: couponId,
    coupon_name: '虚构批量商品测试',
    type_detail: `[${expected.map(id => `{"product_id":${id}}`).join(',')}]`
  } }), couponId);
  assert.deepEqual(result.ids, expected);
  const sheet = readStoredZip(buildXlsx(result)).get('xl/worksheets/sheet1.xml');
  const exported = [...sheet.matchAll(/<c r="B(\d+)" t="inlineStr"><is><t>(\d+)<\/t><\/is><\/c>/g)]
    .filter(match => Number(match[1]) >= 6).map(match => match[2]);
  assert.deepEqual(exported, expected, `${count} 个商品必须全部以文本写入 Excel`);
  console.log(`通过：${count} 个商品的解析、完整导出和长 ID 精度。`);
}
const outputPath = path.join(os.tmpdir(), 'douyin-coupon-exporter-test.xlsx');
await fs.writeFile(outputPath, buildXlsx(coupon));
console.log(`通过：商品 ID 精度和 Excel 生成。测试文件：${outputPath}`);
