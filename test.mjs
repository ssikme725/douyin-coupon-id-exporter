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
const outputPath = path.join(os.tmpdir(), 'douyin-coupon-exporter-test.xlsx');
await fs.writeFile(outputPath, buildXlsx(coupon));
console.log(`通过：商品 ID 精度和 Excel 生成。测试文件：${outputPath}`);
