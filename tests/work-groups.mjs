import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const base = process.env.DISPATCH_TEST_URL ?? "http://127.0.0.1:5081";
const connection = process.env.DISPATCH_TEST_DATABASE;
const password = process.env.DISPATCH_TEST_PASSWORD;
if (process.env.DISPATCH_WORK_CONFIRM !== "ISOLATED" || !password || !connection ||
    !["127.0.0.1", "localhost"].includes(new URL(base).hostname) ||
    !["127.0.0.1", "localhost"].includes(new URL(connection).hostname)) {
  throw Error("Use an explicitly confirmed isolated loopback API and database.");
}
const db = new Client({ connectionString: connection });
await db.connect();
const run = randomUUID().slice(0, 8);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }
async function login(email) {
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  return { Cookie: r.headers.get("set-cookie").split(";")[0], "X-CSRF-Token": body.csrf, "Content-Type": "application/json" };
}
async function command(headers, type, data) {
  const r = await fetch(base + "/api/commands", { method: "POST", headers, body: JSON.stringify({ requestId: randomUUID(), type, data }) });
  const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body;
}
async function read(headers, path) {
  const r = await fetch(base + "/api" + path, { headers });
  const body = await r.json(); assert.equal(r.status, 200, JSON.stringify(body)); return body;
}
const ids = (rows) => rows.map((x) => x.id).sort();
try {
  const admin = await login("admin@electrogroup.test");
  const packing = await command(admin, "importManifest", { name: "Grouping fixture " + run, warehouseId: "main", notes: "Fictional local grouping test", groups: [{ marking: "A", count: 5, lines: [{ sku: "SND01", quantity: 10, unit: "packets" }] }] });
  await command(admin, "approveManifest", { id: packing.id, physicalConfirmed: true });
  const cartons = (await db.query('SELECT "Id" AS id FROM "Cartons" WHERE "ManifestId"=$1 ORDER BY "Id"', [packing.id])).rows;
  assert.equal(cartons.length, 5);
  const labels = await command(admin, "createLabels", { ids: ids(cartons), reason: "Fictional shared print job" });
  await command(admin, "attachLabels", { ids: ids(cartons), physicalConfirmed: true });
  for (const c of cartons) await command(admin, "verifyCarton", { qr: `K1|demo|${c.id}|1`, physicalConfirmed: true });
  const tripA = await command(admin, "createTrip", { vehicle: "QA-ALPHA-" + run, driver: "Grouping test driver" });
  const tripB = await command(admin, "createTrip", { vehicle: "QA-BETA-" + run, driver: "Grouping test driver" });
  const a = await command(admin, "allocate", { tripId: tripA.id, customerId: "ravi", destination: "Fictional North Depot", ids: ids(cartons.slice(0, 2)) });
  const b = await command(admin, "allocate", { tripId: tripA.id, customerId: "meena", destination: "Fictional East Depot", ids: [cartons[2].id] });
  const c = await command(admin, "allocate", { tripId: tripB.id, customerId: "ravi", destination: "Fictional South Depot", ids: [cartons[3].id] });
  await test("work reads require a valid server session", async () => assert.equal((await fetch(base + "/api/work/shipment/" + a.id)).status, 401));
  await test("one shipment returns only its own cartons, trip, allocations and packing list", async () => {
    const work = await read(admin, "/work/shipment/" + a.id);
    assert.deepEqual(ids(work.cartons), ids(cartons.slice(0, 2)));
    assert.deepEqual(ids(work.shipments), [a.id]);
    assert.deepEqual(ids(work.trips), [tripA.id]);
    assert.deepEqual(ids(work.manifests), [packing.id]);
    assert.equal(work.allocations.length, 2);
    assert.equal(work.labels.some((x) => x.id === labels.id), true);
    assert.equal(work.audit.length > 0, true);
  });
  await test("one vehicle keeps its two customers together and excludes the other vehicle", async () => {
    const work = await read(admin, "/work/trip/" + tripA.id);
    assert.deepEqual(ids(work.shipments), [a.id, b.id].sort());
    assert.deepEqual(ids(work.cartons), ids(cartons.slice(0, 3)));
    assert.equal(work.shipments.some((x) => x.id === c.id), false);
  });
  await test("a split packing list finds both vehicles, all shipments and unassigned stock", async () => {
    const work = await read(admin, "/work/packing/" + packing.id);
    assert.deepEqual(ids(work.cartons), ids(cartons));
    assert.deepEqual(ids(work.shipments), [a.id, b.id, c.id].sort());
    assert.deepEqual(ids(work.trips), [tripA.id, tripB.id].sort());
  });
  await test("unknown work kinds and IDs are rejected", async () => {
    assert.equal((await fetch(base + "/api/work/customer/unknown", { headers: admin })).status, 400);
    assert.equal((await fetch(base + "/api/work/shipment/missing", { headers: admin })).status, 404);
  });
  const otherCompany = "work-other-" + run, otherUser = "work-user-" + run, warehouse = "work-wh-" + run, email = "work-" + run + "@fixture.test";
  await db.query('INSERT INTO "Companies" ("Id","Name","Environment") VALUES ($1,$2,\'Test\')', [otherCompany, "Fictional grouping isolation company"]);
  await db.query('INSERT INTO "Warehouses" ("Id","CompanyId","Name") VALUES ($1,$2,\'Fixture warehouse\')', [warehouse, otherCompany]);
  await db.query('INSERT INTO "Products" ("Id","CompanyId","Sku","Name","Unit") VALUES ($1,$2,\'SND01\',\'Fictional pagination item\',\'packets\')', ["work-product-" + run, otherCompany]);
  await db.query('INSERT INTO "Users" ("Id","CompanyId","Email","Name","PasswordHash","Roles","Active") SELECT $1,$2,$3,\'Grouping fixture user\',"PasswordHash",ARRAY[\'Admin\'],TRUE FROM "Users" WHERE "Id"=\'admin\'', [otherUser, otherCompany, email]);
  const other = await login(email);
  await test("a different company cannot open an existing shipment", async () => assert.equal((await fetch(base + "/api/work/shipment/" + a.id, { headers: other })).status, 404));
  const large = await command(other, "importManifest", { name: "Fictional 501-carton pagination", warehouseId: warehouse, notes: "Isolated second-company fixture", groups: [{ marking: "P", count: 501, lines: [{ sku: "SND01", quantity: 1, unit: "packets" }] }] });
  await command(other, "approveManifest", { id: large.id, physicalConfirmed: true });
  await test("selected work loads carton pages beyond the default 200-row dashboard window", async () => {
    const first = await read(other, "/work/packing/" + large.id + "?page=0");
    const second = await read(other, "/work/packing/" + large.id + "?page=1");
    assert.equal(first.cartons.length, 500); assert.equal(first.cartonTotal, 501); assert.equal(first.hasMore, true);
    assert.equal(second.cartons.length, 1); assert.equal(second.hasMore, false);
    assert.equal(new Set([...ids(first.cartons), ...ids(second.cartons)]).size, 501);
  });
  await test("the original company cannot open the other company's packing list", async () => assert.equal((await fetch(base + "/api/work/packing/" + large.id, { headers: admin })).status, 404));
  await test("grouping checks leave Tally posting disabled", async () => assert.equal((await read(admin, "/health")).postingEnabled, false));
  console.log(JSON.stringify({ passed, boundary: "Fictional isolated PostgreSQL/API fixtures only. No actual Tally, printer or scanner was used." }));
} finally { await db.end(); }
