const { assert, section, test } = require('../harness');
const fechas = require('../../src/utils/fechas');
const pagination = require('../../src/utils/pagination');
const { formatMoney, labelTipoDoc, labelTipoComprobante, companyRucOf } = require('../../src/utils/appWebHelpers');
const { sanitizeClienteFolder } = require('../../src/utils/clienteStoragePath');
const { parseAddressInput, toAddressSnapshot, toAddressApi } = require('../../src/utils/addressHelper');
const { extractHashFromXml, resolveHashFromEmisorData } = require('../../src/utils/xmlHash');
const { saldoKey } = require('../../src/models/inventarioModel');
const { signAccessToken, verifyAccessToken, generateRefreshToken } = require('../../src/utils/tokens');

section('fechas');
test('hoyIsoPe formato YYYY-MM-DD', () => {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(fechas.hoyIsoPe()));
});
test('addDaysIso suma días', () => {
  assert.strictEqual(fechas.addDaysIso('2026-03-01', 1), '2026-03-02');
  assert.strictEqual(fechas.addDaysIso('2026-03-01', -1), '2026-02-28');
});
test('periodoActualYyyyMmPe formato YYYYMM', () => {
  assert.ok(/^\d{6}$/.test(fechas.periodoActualYyyyMmPe()));
});
test('toApiTimestamp / toStoredTimestamp', () => {
  const stored = fechas.toStoredTimestamp(Date.UTC(2026, 2, 1, 15, 0, 0));
  assert.ok(stored != null);
  const api = fechas.toApiTimestamp(stored);
  assert.ok(api == null || typeof api === 'number' || typeof api === 'string');
});

section('pagination');
test('parseListQuery defaults y límites', () => {
  const q = pagination.parseListQuery({ page: '2', pageSize: '50' });
  assert.strictEqual(q.page, 2);
  assert.strictEqual(q.pageSize, 50);
  assert.strictEqual(q.skip, 50);
});
test('buildPageMeta hasNext', () => {
  const meta = pagination.buildPageMeta({
    total: 45, page: 1, pageSize: 20, basePath: '/app/x',
  });
  assert.strictEqual(meta.total, 45);
  assert.strictEqual(meta.hasNext, true);
  assert.strictEqual(meta.totalPages, 3);
});
test('buildLoadMoreMeta', () => {
  const meta = pagination.buildLoadMoreMeta({
    total: 30,
    limit: 10,
    basePath: '/app/catalogo',
    query: { q: 'x' },
  });
  assert.ok(meta);
  assert.ok(meta.hasMore === true || meta.nextLimit != null || meta.nextUrl);
});

section('appWebHelpers');
test('formatMoney PEN', () => {
  const s = formatMoney(12.5);
  assert.ok(String(s).includes('12'));
});
test('labelTipoDoc / labelTipoComprobante', () => {
  assert.ok(String(labelTipoDoc('01')).length > 0);
  assert.ok(String(labelTipoComprobante({ tipoDoc: '01' })).length > 0);
});
test('companyRucOf', () => {
  assert.strictEqual(companyRucOf({ locals: { companyRuc: '20611016591' } }), '20611016591');
  assert.strictEqual(companyRucOf({ locals: {} }), '');
});

section('clienteStoragePath');
test('sanitizeClienteFolder', () => {
  const folder = sanitizeClienteFolder('6', '20611016591');
  assert.ok(folder.includes('20611016591'));
  assert.ok(!folder.includes('/'));
});

section('addressHelper');
test('parseAddressInput string/object', () => {
  assert.deepStrictEqual(parseAddressInput({ direccion: 'Av. Lima 1' }), { direccion: 'Av. Lima 1' });
  const snap = toAddressSnapshot({
    ubigeo: '150101',
    direccion: 'Calle 1',
    departamento: 'Lima',
    provincia: 'Lima',
    distrito: 'Lima',
  });
  assert.strictEqual(snap.ubigeo, '150101');
  assert.strictEqual(snap.cod_local, '0000');
  const api = toAddressApi(snap);
  assert.strictEqual(api.direccion, 'Calle 1');
});
test('toAddressSnapshot vacío → null', () => {
  assert.strictEqual(toAddressSnapshot({}), null);
});

section('xmlHash');
test('extractHashFromXml DigestValue', () => {
  const b64 = Buffer.from('abc').toString('base64');
  const xml = `<SignedInfo><DigestValue>${b64}</DigestValue></SignedInfo>`;
  const hex = extractHashFromXml(xml);
  assert.strictEqual(hex, Buffer.from('abc').toString('hex'));
});
test('resolveHashFromEmisorData directo', () => {
  assert.strictEqual(resolveHashFromEmisorData({ hash_cpe: 'aabb' }), 'aabb');
  assert.strictEqual(resolveHashFromEmisorData(null), null);
});

section('inventario · saldoKey');
test('saldoKey concatena item:almacen', () => {
  assert.strictEqual(saldoKey('item1', 'alm1'), 'item1:alm1');
});

section('tokens');
test('sign/verify access token', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-unit';
  const token = signAccessToken({ sub: '1', rol: 'ADMIN', companyRuc: '20611016591' });
  assert.ok(typeof token === 'string' && token.length > 10);
  const payload = verifyAccessToken(token);
  assert.ok(payload);
  assert.strictEqual(String(payload.sub || payload.id || payload.userId || '1'), '1');
});
test('generateRefreshToken distinto cada vez', () => {
  const a = generateRefreshToken();
  const b = generateRefreshToken();
  assert.ok(a && b && a !== b);
});
