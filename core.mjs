const encoder = new TextEncoder();
const xmlEscape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

export function readSelectedCount(text) {
  const counts = [...String(text).matchAll(/已选数量\s*[:：]?\s*([\d,，]+)\s*个?/g)]
    .map(match => Number(match[1].replace(/[,，]/g, '')));
  const unique = [...new Set(counts)];
  return unique.length === 1 && Number.isSafeInteger(unique[0]) && unique[0] > 0 ? unique[0] : null;
}

export function parseCouponResponse(responseText, couponId, { allowMissingProducts = false } = {}) {
  // Quote long integer tokens before JSON.parse; never change digits inside strings.
  const payload = JSON.parse(responseText.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    token => /^-?\d{16,}$/.test(token) ? `"${token}"` : token));
  if (payload.code !== 0 || !payload.data) throw new Error('后台没有返回有效的优惠券数据。');
  const data = payload.data;
  if (String(data.coupon_meta_id) !== String(couponId)) throw new Error('优惠券 ID 与页面不一致。');
  const detail = typeof data.type_detail === 'string' ? data.type_detail : JSON.stringify(data.type_detail ?? null);
  // 19 位商品 ID 超过 JavaScript 安全整数范围，直接从原始文本提取。
  const ids = [...detail.matchAll(/"product_id"\s*:\s*"?(\d+)"?/g)].map(match => match[1]);
  if (!ids.length && !allowMissingProducts) throw new Error('该优惠券没有可导出的指定商品 ID。');
  if (ids.some(id => !/^\d{16,20}$/.test(id))) throw new Error('商品 ID 格式异常。');
  return { id: String(couponId), name: String(data.coupon_name || ''), ids: [...new Set(ids)] };
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function zipStore(files) {
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const filename = encoder.encode(name);
    const bytes = encoder.encode(content);
    const checksum = crc32(bytes);
    const local = new Uint8Array(30 + filename.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint16(10, 0, true);
    l.setUint16(12, 0x0021, true);
    l.setUint32(14, checksum, true);
    l.setUint32(18, bytes.length, true);
    l.setUint32(22, bytes.length, true);
    l.setUint16(26, filename.length, true);
    local.set(filename, 30);
    chunks.push(local, bytes);

    const header = new Uint8Array(46 + filename.length);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x02014b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 20, true);
    h.setUint16(8, 0x0800, true);
    h.setUint16(12, 0, true);
    h.setUint16(14, 0x0021, true);
    h.setUint32(16, checksum, true);
    h.setUint32(20, bytes.length, true);
    h.setUint32(24, bytes.length, true);
    h.setUint16(28, filename.length, true);
    h.setUint32(42, offset, true);
    header.set(filename, 46);
    central.push(header);
    offset += local.length + bytes.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + end.length);
  let position = 0;
  for (const part of [...chunks, ...central, end]) { result.set(part, position); position += part.length; }
  return result;
}

export function buildXlsx(coupon) {
  const textCell = (ref, value, style = 0) => `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t>${xmlEscape(value)}</t></is></c>`;
  const rows = [
    `<row r="1">${textCell('A1', '抖音优惠券商品 ID 清单', 1)}</row>`,
    `<row r="2">${textCell('A2', `优惠券：${coupon.name}`)}${textCell('B2', `优惠券 ID：${coupon.id}`)}</row>`,
    `<row r="3">${textCell('A3', `商品数量：${coupon.ids.length} 个`)}${textCell('B3', '商品 ID 按文本保存')}</row>`,
    `<row r="5">${textCell('A5', '序号', 2)}${textCell('B5', '商品ID', 2)}</row>`
  ];
  coupon.ids.forEach((id, index) => rows.push(`<row r="${index + 6}"><c r="A${index + 6}"><v>${index + 1}</v></c>${textCell(`B${index + 6}`, id)}</row>`));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B${coupon.ids.length + 5}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="38" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A5:B${coupon.ids.length + 5}"/></worksheet>`;
  const files = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="商品ID" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ['xl/worksheets/sheet1.xml', sheet]
  ];
  return zipStore(files);
}
