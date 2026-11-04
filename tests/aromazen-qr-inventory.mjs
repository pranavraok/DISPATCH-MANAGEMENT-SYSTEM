import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Only disposable loopback APIs. Never point this suite at company deployments.
const config = JSON.parse(readFileSync(new URL('../.local/single-scan-qa.json', import.meta.url)));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function login(cfg, email = cfg.email, password = cfg.password) {
  assert.match(cfg.url, /^http:\/\/127\.0\.0\.1:/);
  const response = await fetch(cfg.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200, await response.clone().text()); const data = await response.json();
  const headers = { 'Content-Type': 'application/json', Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': data.csrf };
  const get = async path => { const r = await fetch(cfg.url + '/api' + path, { headers }); assert.equal(r.status, 200, await r.clone().text()); return r.json(); };
  const request = async (type, data, requestId = randomUUID()) => { const r = await fetch(cfg.url + '/api/commands', { method: 'POST', headers, body: JSON.stringify({ requestId, type, data: { ...data, workflow: cfg === config.aromazon ? 'StockFirst' : 'OrderFirst' } }) }); return { status: r.status, data: await r.json() }; };
  const ok = async (...args) => { const r = await request(...args); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  return { get, request, ok, headers, cfg };
}
const a = await login(config.aromazon), e = await login(config.electro);
const suffix = randomUUID().slice(0, 8);
const current = () => a.get('/state');
const stateOf = async id => (await current()).cartons.find(c => c.id === id);
const qr = (c, revision = c.revision) => `K1|aromazon-india|${c.id}|${revision}`;
const company = 'AROMAZEN QA ONLY';
const connector = await a.ok('pairConnector', { name: 'Isolated QA connector', expectedCompany: company });
const connectorHeaders = { 'Content-Type': 'application/json', 'X-Connector-Id': connector.id, 'X-Connector-Key': connector.secret };
async function connectorCall(path, body, method = 'POST') { const r = await fetch(config.aromazon.url + '/api/connector' + path, { method, headers: connectorHeaders, ...(body ? { body: JSON.stringify(body) } : {}) }); const text = await r.text(); return { status: r.status, data: text ? JSON.parse(text) : null }; }
await a.ok('saveMapping', { expectedCompany: company, tallyVersion: 'QA simulated', salesLedger: 'QA Sales', voucherType: 'Sales', statutoryRequired: false, reason: 'Isolated fixture mapping' });
await connectorCall('/heartbeat', { company, environment: 'Production', tallyReachable: true, version: '1.8.0-company-dispatch' });
const masters = { company, environment: 'Production', companyState: 'Karnataka', items: [
  { nativeId: 'qa-product-a-' + suffix, name: 'QA Bottles A ' + suffix, unit: 'bottles', balance: 10000, hsnCode: '3307', gstRate: 18, group: 'QA', standardSellingPrice: 10 },
  { nativeId: 'qa-product-b-' + suffix, name: 'QA Bottles B ' + suffix, unit: 'bottles', balance: 10000, hsnCode: '3307', gstRate: 18, group: 'QA', standardSellingPrice: 20 },
], ledgers: [
  { nativeId: 'qa-customer-' + suffix, name: 'QA Customer ' + suffix, group: 'Sundry Debtors', address: 'QA address, Karnataka', stateName: 'Karnataka' },
  { nativeId: 'qa-other-customer-' + suffix, name: 'QA Other Customer ' + suffix, group: 'Sundry Debtors', address: 'QA other address, Karnataka', stateName: 'Karnataka' },
  { nativeId: 'qa-sales', name: 'QA Sales', group: 'Sales Accounts' },
  ...['CGST', 'SGST', 'IGST'].map(tax => ({ nativeId: 'qa-' + tax, name: 'Output ' + tax, group: 'Duties & Taxes' })),
] };
await test('AROMAZEN accepts its own exact-company masters and rejects another company', async () => {
  assert.equal((await connectorCall('/masters', { ...masters, company: 'ELECTRO GROUP OF INDUSTRIES' })).status, 400);
  const r = await connectorCall('/masters', masters); assert.equal(r.status, 200, JSON.stringify(r.data));
});
const initial = await current();
const products = masters.items.map(item => initial.products.find(p => p.tallyId === item.nativeId));
assert.ok(products.every(Boolean));
const customer = initial.customers.find(c => c.tallyId === masters.ledgers[0].nativeId);
const lines = products.map((p, i) => ({ sku: p.sku, quantity: i ? 8 : 12, unit: 'bottles' }));
const baseline = (await current()).packedInventory;
let cartons;
await test('saving carton contents creates plans but does not add inventory before QR generation', async () => {
  const r = await a.ok('registerStockCartons', { name: 'QA Mixed ' + suffix, warehouseId: 'main', notes: '', groups: [{ marking: 'QA MIX', count: 3, lines }] });
  cartons = r.cartons; assert.equal(cartons.length, 3); assert.equal(new Set(cartons.map(c => c.id)).size, 3);
  assert.ok(cartons.every(c => c.state === 'PendingLabel'));
  const summary = (await current()).packedInventory; assert.equal(summary.availableCartons, baseline.availableCartons); assert.equal(summary.products.some(p => p.sku === products[0].sku), false);
});
await test('QR generation adds the cartons and exact product totals without receipt or supervisor approval', async () => {
  const requestId = randomUUID(); const data = { ids: cartons.map(c => c.id), reason: 'QA initial QR labels' };
  const label = await a.ok('createLabels', data, requestId); assert.equal(label.cartons.length, 3); assert.ok(label.cartons.every(c => c.state === 'Available'));
  assert.deepEqual(await a.ok('createLabels', data, requestId), label);
  const summary = (await current()).packedInventory; assert.equal(summary.availableCartons, baseline.availableCartons + 3);
  assert.equal(summary.products.find(p => p.sku === products[0].sku).quantity, 36); assert.equal(summary.products.find(p => p.sku === products[1].sku).quantity, 24);
});
await test('reprinting the same QR labels never adds cartons or product quantities', async () => {
  const before = (await current()).packedInventory;
  const label = await a.ok('createLabels', { ids: [cartons[0].id], reason: 'QA damaged-label reprint' });
  assert.equal(label.cartons[0].id, cartons[0].id); assert.equal(label.cartons[0].revision, 1);
  assert.deepEqual((await current()).packedInventory, before);
});
await test('the removed inventory receipt and receiving approval commands cannot change stock', async () => {
  assert.equal((await a.request('receiveCarton', { qr: qr(cartons[0]), physicalConfirmed: true })).status, 410);
  assert.equal((await a.request('attachLabels', { ids: [cartons[0].id], physicalConfirmed: true, contentsConfirmed: true, revisions: [{ id: cartons[0].id, revision: 1 }] })).status, 409);
});
const staffPassword = randomUUID() + '-QA-only';
await a.ok('createUser', { name: 'QA packing clerk', email: `clerk-${suffix}@qa.local`, password: staffPassword, roles: ['PackingClerk'] });
const clerk = await login(config.aromazon, `clerk-${suffix}@qa.local`, staffPassword);
await test('packing staff can generate QR labels without needing a supervisor role', async () => {
  assert.equal((await clerk.ok('createLabels', { ids: [cartons[0].id], reason: 'QA clerk label reprint' })).cartons[0].state, 'Available');
});
await test('read-only QR lookup returns all product contents without changing inventory', async () => {
  const before = (await current()).packedInventory;
  const result = await a.get('/cartons/lookup?qr=' + encodeURIComponent(qr(cartons[0])));
  assert.equal(result.lines.length, 2); assert.equal(result.carton.state, 'Available');
  assert.deepEqual((await current()).packedInventory, before);
});
const otherCustomer = initial.customers.find(c => c.tallyId === masters.ledgers[1].nativeId);
const begin = (reference, customerId = customer.id) => a.ok('beginStockDispatch', { reference: reference + suffix, customerId, warehouseId: 'main', destination: 'QA address, Karnataka' });
const dispatch = await begin('QA-ORDER-');
const session = await a.ok('startLoading', { shipmentId: dispatch.id, station: 'QA-STATION' });
const scan = c => ({ sessionId: session.id, station: 'QA-STATION', qr: qr(c), mode: 'live' });
await test('dispatch rejects cartons whose QR has not been generated and cartons on hold', async () => {
  const plan = await a.ok('registerStockCartons', { name: 'QA no QR ' + suffix, warehouseId: 'main', notes: '', groups: [{ marking: 'NO QR', count: 1, lines }] });
  assert.equal((await a.ok('scan', scan(plan.cartons[0]))).outcome, 'Rejected');
  await a.ok('holdCarton', { id: cartons[0].id, held: true, reason: 'QA held carton check' });
  assert.equal((await a.ok('scan', scan(cartons[0]))).outcome, 'Rejected');
  await a.ok('holdCarton', { id: cartons[0].id, held: false, reason: 'QA cleared carton hold' });
});
await test('dispatch scan allocates and loads a whole mixed carton and creates one draft bill', async () => {
  assert.equal((await a.ok('scan', scan(cartons[0]))).outcome, 'Accepted');
  const s = await current(); const sh = s.shipments.find(x => x.id === dispatch.id); const b = s.billings.find(x => x.shipmentId === sh.id && x.revision === sh.billingVersion);
  assert.equal(sh.billingVersion, 1); assert.equal(b.total, 280); assert.equal(JSON.parse(b.snapshot).lines.length, 2);
  assert.equal(s.allocations.filter(x => x.cartonId === cartons[0].id && x.active).length, 1);
  assert.equal(s.packedInventory.products.find(p => p.sku === products[0].sku).quantity, 24);
  assert.equal(s.packedInventory.products.find(p => p.sku === products[1].sku).quantity, 16);
});
await test('concurrent duplicate dispatch scans leave carton quantities and bill revision unchanged', async () => {
  const responses = await Promise.all(Array.from({ length: 5 }, () => a.ok('scan', scan(cartons[0]))));
  assert.ok(responses.every(r => r.outcome === 'Duplicate'));
  const s = await current(); assert.equal(s.shipments.find(x => x.id === dispatch.id).billingVersion, 1);
});
await test('a second mixed carton adds both products to the same customer bill', async () => {
  assert.equal((await a.ok('scan', scan(cartons[1]))).outcome, 'Accepted');
  const s = await current(); const sh = s.shipments.find(x => x.id === dispatch.id); const b = s.billings.find(x => x.shipmentId === sh.id && x.revision === sh.billingVersion);
  assert.equal(b.total, 560); assert.deepEqual(JSON.parse(b.snapshot).lines.map(x => x.quantity).sort((a,b)=>a-b), [16, 24]);
  assert.equal(s.packedInventory.products.find(p => p.sku === products[0].sku).quantity, 12);
  assert.equal(s.packedInventory.products.find(p => p.sku === products[1].sku).quantity, 8);
});
await test('another customer dispatch cannot claim a loaded carton', async () => {
  const other = await begin('QA-OTHER-', otherCustomer.id); const otherSession = await a.ok('startLoading', { shipmentId: other.id, station: 'QA-OTHER-STATION' });
  assert.equal((await a.ok('scan', { ...scan(cartons[0]), sessionId: otherSession.id, station: 'QA-OTHER-STATION' })).outcome, 'Rejected');
});
await test('unload restores inventory and rebuilds the draft bill without the removed carton', async () => {
  await a.ok('unload', { id: cartons[1].id, shipmentId: dispatch.id, reason: 'QA physical unload' });
  const s = await current(); const sh = s.shipments.find(x => x.id === dispatch.id);
  assert.equal((await stateOf(cartons[1].id)).state, 'Available'); assert.equal(s.billings.find(x => x.shipmentId === sh.id && x.revision === sh.billingVersion).total, 280);
  assert.equal(s.packedInventory.products.find(p => p.sku === products[0].sku).quantity, 24);
});
await test('revised contents require a new QR and stale labels are rejected', async () => {
  await a.ok('reviseCarton', { id: cartons[1].id, lines, reason: 'QA physical contents revision' });
  assert.equal((await stateOf(cartons[1].id)).state, 'PendingLabel');
  assert.equal((await a.ok('scan', scan(cartons[1]))).outcome, 'Rejected');
  await a.ok('createLabels', { ids: [cartons[1].id], reason: 'QA new revision label' });
  assert.equal((await stateOf(cartons[1].id)).state, 'Available');
  assert.equal((await a.ok('scan', scan(cartons[1]))).outcome, 'Rejected');
});
await test('billing cannot be approved or invoiced until physical loading is approved', async () => {
  const s = await current(); const sh = s.shipments.find(x => x.id === dispatch.id); const b = s.billings.find(x => x.shipmentId === sh.id && x.revision === sh.billingVersion);
  assert.equal((await a.request('approveBilling', { id: b.id, physicalConfirmed: true })).status, 400);
  await a.ok('approveLoad', { id: sh.id, physicalConfirmed: true });
  await a.ok('approveBilling', { id: b.id, physicalConfirmed: true });
  assert.equal((await a.request('queueInvoice', { id: sh.id })).status, 409);
});
await test('AROMAZEN validates its own mapping and queues an exact-company Tally invoice', async () => {
  await a.ok('validateTallyContract', { confirmedCompany: true, reason: 'QA simulated mapping verification' });
  const job = await a.ok('queueInvoice', { id: dispatch.id }); assert.equal(job.state, 'Queued');
  const claim = await connectorCall('/jobs/next', null, 'GET'); assert.equal(claim.status, 200); assert.equal(claim.data.payload.company, company); assert.equal(claim.data.payload.lines.length, 2); assert.equal(claim.data.payload.total, 330.4);
  const sending = await connectorCall(`/jobs/${job.id}/sending`, { payloadHash: claim.data.payloadHash }); assert.equal(sending.status, 200);
  const readback = { ...claim.data.payload, voucherNumber: 'SIMULATED-QA-NO-TALLY-' + suffix, reference: claim.data.payload.reference };
  const invalid = await connectorCall(`/jobs/${job.id}/result`, { payloadHash: claim.data.payloadHash, state: 'Confirmed', readback: { ...readback, company: 'WRONG COMPANY' } }); assert.equal(invalid.status, 409);
  const valid = await connectorCall(`/jobs/${job.id}/result`, { payloadHash: claim.data.payloadHash, state: 'Confirmed', readback }); assert.equal(valid.status, 200, JSON.stringify(valid.data));
  const invoice = await a.get('/documents/invoice/' + dispatch.id); assert.match(invoice.invoice.voucherNumber, /^SIMULATED-QA-NO-TALLY/);
});
await test('Electro rejects AROMAZEN-only commands and still creates order-first label-ready cartons', async () => {
  assert.equal((await e.request('registerStockCartons', { name: 'Forbidden', warehouseId: 'main', groups: [] })).status, 403);
  assert.equal((await e.request('receiveCarton', { qr: qr(cartons[0]), physicalConfirmed: true })).status, 410);
  await e.ok('saveProduct', { sku: 'E-QA-' + suffix, name: 'Electro QA item', unit: 'Nos', reason: 'Isolated Electro regression fixture' });
  const c = await e.ok('saveCustomer', { name: 'Electro QA customer', address: 'QA address Karnataka', reason: 'Isolated Electro regression fixture' });
  const order = await e.ok('createOrder', { reference: 'E-QA-' + suffix, customerId: c.id, warehouseId: 'main', destination: 'QA Karnataka', expectedCartons: 1, lines: [], notes: '', boxGroups: [{ marking: 'E', count: 1, lines: [{ sku: 'E-QA-' + suffix, quantity: 20, unit: 'Nos' }] }] });
  const s = await e.get('/state'); const box = s.cartons.find(c => c.manifestId === order.manifestId); assert.equal(box.state, 'Available');
  await e.ok('attachLabels', { ids: [box.id], physicalConfirmed: true, contentsConfirmed: true, revisions: [{ id: box.id, revision: 1 }] });
  const ready = await e.get('/state'); assert.ok(ready.shipments.some(sh => sh.orderId === order.id));
  assert.equal(ready.mapping.pattern, 'Unvalidated');
});
await test('cross-company sessions, connectors and QR lookups remain isolated', async () => {
  assert.equal((await fetch(config.aromazon.url + '/api/auth/me', { headers: e.headers })).status, 401);
  assert.equal((await fetch(config.electro.url + '/api/cartons/lookup?qr=' + encodeURIComponent(qr(cartons[0])), { headers: e.headers })).status, 400);
  assert.equal((await fetch(config.electro.url + '/api/connector/heartbeat', { method: 'POST', headers: connectorHeaders, body: JSON.stringify({ company, environment: 'Production' }) })).status, 401);
});
await test('two customers competing to scan the same available carton produce exactly one load', async () => {
  const packed = await a.ok('registerStockCartons', { name: 'QA competing scans ' + suffix, warehouseId: 'main', notes: '', groups: [{ marking: 'RACE', count: 1, lines }] });
  const c = packed.cartons[0]; await a.ok('createLabels', { ids: [c.id], reason: 'QA QR inventory generation' });
  const dispatches = await Promise.all([begin('QA-RACE-A-'), begin('QA-RACE-B-', otherCustomer.id)]);
  const sessions = await Promise.all(dispatches.map((sh, i) => a.ok('startLoading', { shipmentId: sh.id, station: 'QA-RACE-' + i })));
  const responses = await Promise.all(sessions.map((session, i) => a.ok('scan', { sessionId: session.id, station: 'QA-RACE-' + i, qr: qr(c), mode: 'live' })));
  assert.equal(responses.filter(r => r.outcome === 'Accepted').length, 1); assert.equal(responses.filter(r => r.outcome === 'Rejected').length, 1);
  assert.equal((await current()).allocations.filter(x => x.cartonId === c.id && x.active).length, 1);
});
await test('a missing Tally price requires explicit bill editing before approval', async () => {
  await a.ok('saveProduct', { sku: 'MISSING-' + suffix, name: 'QA missing price', unit: 'bottles', reason: 'QA missing-price fixture' });
  const packed = await a.ok('registerStockCartons', { name: 'QA no price ' + suffix, warehouseId: 'main', notes: '', groups: [{ marking: 'NO PRICE', count: 1, lines: [{ sku: 'MISSING-' + suffix, quantity: 20, unit: 'bottles' }] }] });
  const c = packed.cartons[0]; await a.ok('createLabels', { ids: [c.id], reason: 'QA QR inventory generation' });
  const sh = await begin('QA-NOPRICE-'); const session = await a.ok('startLoading', { shipmentId: sh.id, station: 'QA-NOPRICE' });
  await a.ok('scan', { sessionId: session.id, station: 'QA-NOPRICE', qr: qr(c), mode: 'live' });
  await a.ok('approveLoad', { id: sh.id, physicalConfirmed: true });
  const s = await current(); const shipment = s.shipments.find(x => x.id === sh.id); const bill = s.billings.find(x => x.shipmentId === sh.id && x.revision === shipment.billingVersion);
  assert.equal((await a.request('approveBilling', { id: bill.id, physicalConfirmed: true })).status, 409);
});
await test('cartons support one product or three products, without a two-product restriction', async () => {
  const third = 'THIRD-' + suffix;
  await a.ok('saveProduct', { sku: third, name: 'QA third bottle product', unit: 'bottles', reason: 'QA flexible carton contents' });
  const solo = await a.ok('registerStockCartons', { name: 'QA single product ' + suffix, warehouseId: 'main', notes: '', groups: [{ marking: 'SINGLE', count: 1, lines: [{ sku: third, quantity: 20, unit: 'bottles' }] }] });
  const mixed = await a.ok('registerStockCartons', { name: 'QA three products ' + suffix, warehouseId: 'main', notes: '', groups: [{ marking: 'TRIPLE', count: 2, lines: [...lines, { sku: third, quantity: 3, unit: 'bottles' }] }] });
  await a.ok('createLabels', { ids: [...solo.cartons, ...mixed.cartons].map(c => c.id), reason: 'QA one and three products' });
  const s = await current(); assert.equal(s.packedInventory.products.find(p => p.sku === third).quantity, 26);
  assert.equal(JSON.parse((await stateOf(mixed.cartons[0].id)).lines).length, 3);
});
await test('product inventory totals include cartons beyond the displayed page and reprints remain neutral', async () => {
  const sku = 'PAGE-' + suffix;
  await a.ok('saveProduct', { sku, name: 'QA pagination product', unit: 'bottles', reason: 'QA whole-inventory totals' });
  const plan = await a.ok('registerStockCartons', { name: 'QA paged cartons ' + suffix, warehouseId: 'main', notes: '', groups: [{ marking: 'PAGE', count: 201, lines: [{ sku, quantity: 20, unit: 'bottles' }] }] });
  const data = { ids: plan.cartons.map(c => c.id), reason: 'QA paginated inventory QR' };
  await a.ok('createLabels', data);
  const page = await a.get('/state?workflow=StockFirst&pageSize=1&page=0'); assert.equal(page.cartons.length, 1);
  const product = page.packedInventory.products.find(p => p.sku === sku); assert.equal(product.quantity, 4020); assert.equal(product.cartons, 201);
  await a.ok('createLabels', { ...data, reason: 'QA reprint paged QR labels' });
  const after = await current(); assert.equal(after.packedInventory.products.find(p => p.sku === sku).quantity, 4020);
});
console.log(`${passed} QR inventory workflow and Electro isolation checks passed. Tally readback was simulated; no Tally voucher was created.`);
