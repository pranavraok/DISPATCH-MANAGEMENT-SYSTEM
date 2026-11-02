import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Requires two disposable local databases; never run this against company records.
const config = JSON.parse(readFileSync(new URL('../.local/company-qa.json', import.meta.url)));
const clients = {};
const suffix = randomUUID().slice(0, 8);
for (const [slug, cfg] of Object.entries(config)) {
  assert.match(cfg.url, /^http:\/\/127\.0\.0\.1:/);
  const site = await (await fetch(cfg.url + '/api/site')).json();
  assert.equal(site.slug, slug);
  const login = await fetch(cfg.url + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: cfg.email, password: cfg.password }) });
  assert.equal(login.status, 200);
  const auth = await login.json();
  const headers = { 'Content-Type': 'application/json', Cookie: login.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': auth.csrf };
  const request = async (type, data, flow = site.workflow) => {
    const r = await fetch(cfg.url + '/api/commands', { method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID(), type, data: { ...data, workflow: flow } }) });
    return { status: r.status, data: await r.json() };
  };
  const ok = async (type, data) => { const r = await request(type, data); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const state = async () => { const r = await fetch(cfg.url + '/api/state', { headers }); assert.equal(r.status, 200); return r.json(); };
  const otherFlow = site.workflow === 'OrderFirst' ? 'StockFirst' : 'OrderFirst';
  assert.equal((await fetch(cfg.url + '/api/state?workflow=' + otherFlow, { headers })).status, 409);
  assert.equal((await request('createTrip', { vehicle: 'QA', driver: 'QA driver' }, otherFlow)).status, 409);
  const customer = await ok('saveCustomer', { name: slug + ' fictional customer ' + suffix, address: 'Isolated QA address', reason: 'Isolation QA' });
  await ok('saveProduct', { sku: 'QA-' + suffix, name: slug + ' fictional product', unit: 'Nos', reason: 'Isolation QA' });
  const contents = [{ sku: 'QA-' + suffix, quantity: 10, unit: 'Nos' }];
  const orderInput = { reference: 'PO-' + suffix, customerId: customer.id, warehouseId: 'main', destination: 'Fictional depot', expectedCartons: 2, lines: [{ ...contents[0], quantity: 20 }], notes: 'Fictional only' };
  let order;
  if (site.workflow === 'OrderFirst') order = await ok('createOrder', orderInput);
  const packInput = { name: slug + ' QA pack ' + suffix, warehouseId: 'main', customerId: order ? customer.id : null, orderId: order?.id ?? null, notes: 'Fictional only', groups: [{ marking: 'A', count: site.workflow === 'StockFirst' ? 3 : 2, lines: contents }] };
  if (site.workflow === 'OrderFirst') assert.equal((await request('saveManifest', { ...packInput, orderId: null, customerId: null })).status, 400);
  const pack = await ok('saveManifest', packInput);
  await ok('approveManifest', { id: pack.id, physicalConfirmed: true });
  const boxes = (await state()).cartons.filter(c => c.manifestId === pack.id);
  await ok('createLabels', { ids: boxes.map(c => c.id), reason: 'QA labels' });
  await ok('attachLabels', { ids: boxes.map(c => c.id), revisions: boxes.map(c => ({ id: c.id, revision: c.revision })), physicalConfirmed: true, contentsConfirmed: true });
  if (!order) order = await ok('createOrder', orderInput);
  const trip = await ok('createTrip', { vehicle: 'QA-' + slug + '-' + suffix, driver: 'Fictional driver' });
  const sh = await ok('allocate', { tripId: trip.id, orderId: order.id, customerId: customer.id, destination: orderInput.destination, ids: boxes.slice(0, 2).map(c => c.id) });
  const session = await ok('startLoading', { shipmentId: sh.id, station: 'SAME-PHYSICAL-SCANNER' });
  const qr = box => 'Q' + Buffer.from(box.id.slice(3), 'hex').toString('base64url') + '.' + box.revision;
  const scan = box => ({ sessionId: session.id, station: 'SAME-PHYSICAL-SCANNER', qr: qr(box), mode: 'live' });
  const previousCompany = Object.values(clients)[0];
  if (previousCompany) assert.equal((await ok('scan', scan(previousCompany.boxes[0]))).outcome, 'Rejected');
  for (const box of boxes.slice(0, 2)) assert.equal((await ok('scan', scan(box))).outcome, 'Accepted');
  assert.equal((await ok('scan', scan(boxes[0]))).outcome, 'Duplicate');
  await ok('approveLoad', { id: sh.id, physicalConfirmed: true });
  const bill = await ok('saveBilling', { shipmentId: sh.id, rates: [{ sku: contents[0].sku, rate: 25, discountPercent: 0 }], freight: 0, otherCharges: 0, terms: 'QA only', reason: 'QA rate', version: 0 });
  assert.equal(bill.total, 500);
  await ok('approveBilling', { id: bill.id, physicalConfirmed: true });
  assert.equal((await ok('queueInvoice', { id: sh.id })).state, 'Blocked');
  await ok('saveMapping', { expectedCompany: slug + ' ISOLATED TALLY TEST', tallyVersion: 'QA only', salesLedger: slug + ' sales', voucherType: 'Sales', statutoryRequired: true, reason: 'Separate Tally QA' });
  const connector = await ok('pairConnector', { name: slug + ' test PC', expectedCompany: slug + ' ISOLATED TALLY TEST' });
  const saved = await state();
  if (site.workflow === 'StockFirst') assert.equal(saved.cartons.find(c => c.id === boxes[2].id).state, 'Available');
  assert.equal(saved.workflow, site.workflow);
  clients[slug] = { cfg, headers, state, request, saved, connector, boxes, scan };
}
for (const [slug, current] of Object.entries(clients)) {
  const other = clients[slug === 'electro' ? 'aromazon' : 'electro'];
  assert.notEqual(current.saved.company.id, other.saved.company.id);
  assert.equal(current.saved.products.some(p => p.name.startsWith(other.cfg.slug)), false);
  assert.equal(current.saved.customers.some(p => p.name.startsWith(other.cfg.slug)), false);
  assert.equal(current.saved.mapping.salesLedger, slug + ' sales');
  assert.equal((await fetch(current.cfg.url + '/api/auth/me', { headers: other.headers })).status, 401);
  assert.equal((await fetch(current.cfg.url + '/api/connector/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Connector-Id': other.connector.id, 'X-Connector-Key': other.connector.secret }, body: JSON.stringify({ company: other.cfg.slug + ' ISOLATED TALLY TEST', environment: 'Test', tallyReachable: false, version: 'QA', detail: '' }) })).status, 401);
  assert.equal((await current.request('holdCarton', { id: other.boxes[0].id, held: true, reason: 'Cross-company QA' })).status, 404);
  assert.equal((await fetch(current.cfg.url + '/api/cartons/' + other.boxes[0].id + '/history', { headers: current.headers })).status, 404);
  assert.equal((await fetch(current.cfg.url + '/api/documents/shipment/' + other.saved.shipments[0].id, { headers: current.headers })).status, 404);
}
console.log(JSON.stringify({ status: 'PASS', separateDatabases: true, workflowsLocked: true, isolatedLoginsMastersAndTally: true, crossSiteCookiesAndConnectorKeysRejected: true, crossCompanyQrRejected: true, bothFlowsThroughBilling: true, oneScanPerCarton: true, realTallyPosting: false }));
