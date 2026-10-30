import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
const base = process.env.DISPATCH_TEST_URL ?? "http://127.0.0.1:5080";
const password = process.env.DISPATCH_TEST_PASSWORD;
if (!password)
  throw Error(
    "Set DISPATCH_TEST_PASSWORD for an isolated seeded test environment.",
  );
const db = process.env.DISPATCH_TEST_DATABASE
  ? new Client({ connectionString: process.env.DISPATCH_TEST_DATABASE })
  : null;
if (db) await db.connect();
const results = [];
async function test(name, fn) {
  const start = performance.now();
  try {
    await fn();
    results.push({
      name,
      status: "PASS",
      ms: Math.round(performance.now() - start),
    });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, status: "FAIL", error: e.message });
    console.error("FAIL " + name + " " + e.stack);
    throw e;
  }
}
async function login(email = "admin@kriyantha.test", pw = password) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  assert.equal(
    r.status,
    200,
    await r
      .text()
      .then((x) => x.slice(0, 100))
      .catch(() => ""),
  );
}
// Keep independent server sessions so racing requests exercise the database, not a shared JS queue.
async function session(email, pw) {
  const r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pw }),
  });
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  return {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: data.csrf,
    user: data.user,
  };
}
const admin = await session("admin@kriyantha.test", password);
async function call(auth, path, method = "GET", data, csrf = true) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      Cookie: auth.cookie,
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": auth.csrf } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function cmd(type, data, auth = admin, requestId = randomUUID()) {
  return call(auth, "/commands", "POST", { requestId, type, data });
}
async function ok(type, data, auth = admin, requestId) {
  const r = await cmd(type, data, auth, requestId);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
let state = () =>
  call(admin, "/state").then((r) => {
    assert.equal(r.status, 200);
    return r.data;
  });
const runId = randomUUID().slice(0, 8);
let manifest, cartons, trip, shipment, loading, mixed, approvedBill;
try {
  await test("health reaches real PostgreSQL", async () => {
    const r = await fetch(base + "/api/health");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).database, "Connected");
  });
  await test("unauthenticated operations are denied", async () => {
    const r = await fetch(base + "/api/state");
    assert.equal(r.status, 401);
  });
  await test("CSRF token is mandatory for writes", async () => {
    const r = await call(
      admin,
      "/commands",
      "POST",
      {
        requestId: randomUUID(),
        type: "createTrip",
        data: { vehicle: "KA-01", driver: "Test" },
      },
      false,
    );
    assert.equal(r.status, 403);
  });
  await test("strict server import rejects unknown SKU, negative and ambiguous units", async () => {
    for (const line of [
      { sku: "unknown", quantity: 10, unit: "packets" },
      { sku: "SND01", quantity: -1, unit: "packets" },
      { sku: "SND01", quantity: 10, unit: "kg" },
    ])
      assert.equal(
        (
          await cmd("importManifest", {
            name: "Invalid " + runId,
            warehouseId: "main",
            notes: "",
            groups: [{ marking: "A", count: 1, lines: [line] }],
          })
        ).status,
        400,
      );
  });
  await test("small mixed fixture draft saves idempotently", async () => {
    const data = {
      name: "Integration " + runId,
      warehouseId: "main",
      customerId: null,
      notes: "Fictional integration fixture",
      groups: [
        {
          marking: "A",
          count: 4,
          lines: [{ sku: "SND01", quantity: "100", unit: "packets" }],
        },
        {
          marking: "B",
          count: 3,
          lines: [{ sku: "SND01", quantity: "80", unit: "packets" }],
        },
        {
          marking: "C",
          count: 2,
          lines: [{ sku: "ROS01", quantity: "100", unit: "packets" }],
        },
        {
          marking: "D",
          count: 1,
          lines: [
            { sku: "SND01", quantity: "40", unit: "packets" },
            { sku: "ROS01", quantity: "20", unit: "packets" },
          ],
        },
      ],
    };
    const id = randomUUID();
    manifest = await ok("importManifest", data, admin, id);
    assert.deepEqual(await ok("importManifest", data, admin, id), manifest);
  });
  await test("request ID reuse with different payload is rejected", async () => {
    const id = randomUUID();
    await ok(
      "createTrip",
      { vehicle: "KA-TEST", driver: "Fictional" },
      admin,
      id,
    );
    assert.equal(
      (
        await cmd(
          "createTrip",
          { vehicle: "KA-OTHER", driver: "Fictional" },
          admin,
          id,
        )
      ).status,
      409,
    );
  });
  await test("approval requires physical confirmation", async () =>
    assert.equal(
      (
        await cmd("approveManifest", {
          id: manifest.id,
          physicalConfirmed: false,
        })
      ).status,
      400,
    ));
  await test("approval creates unique cartons once across independent retries", async () => {
    await ok("approveManifest", { id: manifest.id, physicalConfirmed: true });
    await ok("approveManifest", { id: manifest.id, physicalConfirmed: true });
    cartons = (await state()).cartons.filter(
      (c) => c.manifestId === manifest.id,
    );
    assert.equal(cartons.length, 10);
    assert.equal(new Set(cartons.map((c) => c.id)).size, 10);
    mixed = cartons.find((c) => JSON.parse(c.lines).length === 2);
  });
  await test("mixed fixture totals are 680 Sandal and 220 Rose", async () => {
    const totals = {};
    for (const c of cartons)
      for (const l of JSON.parse(c.lines))
        totals[l.sku] = (totals[l.sku] ?? 0) + l.quantity;
    assert.deepEqual(totals, { SND01: 680, ROS01: 220 });
  });
  await test("unverified cartons cannot be reserved", async () => {
    trip = await ok("createTrip", {
      vehicle: "KA-INTEGRATION",
      driver: "Fictional Driver",
      transporter: "Demo only",
    });
    assert.equal(
      (
        await cmd("allocate", {
          tripId: trip.id,
          customerId: "ravi",
          destination: "Mysuru",
          ids: [mixed.id],
        })
      ).status,
      400,
    );
  });
  await test("reprinting retains exact identity and revision", async () => {
    const first = await ok("createLabels", {
      ids: [mixed.id],
      reason: "First test label",
    });
    const second = await ok("createLabels", {
      ids: [mixed.id],
      reason: "Printer failure reprint",
    });
    assert.equal(first.cartons[0].id, second.cartons[0].id);
    assert.equal(first.cartons[0].revision, second.cartons[0].revision);
    assert.equal(
      (await state()).cartons.filter((c) => c.manifestId === manifest.id)
        .length,
      10,
    );
  });
  await test("attachment and content verification are separate", async () => {
    await ok("attachLabels", {
      ids: cartons.map((c) => c.id),
      physicalConfirmed: true,
    });
    for (const c of cartons)
      await ok("verifyCarton", {
        qr: `K1|demo|${c.id}|1`,
        physicalConfirmed: true,
      });
    assert.equal(
      (await state()).cartons.find((c) => c.id === mixed.id).verified,
      true,
    );
  });
  await test("held cartons cannot be reserved", async () => {
    const c = cartons.find((c) => c.id !== mixed.id);
    await ok("holdCarton", { id: c.id, held: true, reason: "QC check" });
    assert.equal(
      (
        await cmd("allocate", {
          tripId: trip.id,
          customerId: "ravi",
          destination: "Mysuru",
          ids: [c.id],
        })
      ).status,
      400,
    );
    await ok("holdCarton", { id: c.id, held: false, reason: "QC cleared" });
  });
  await test("two operators competing for a reservation yield one allocation", async () => {
    const c = cartons.find((c) => c.id !== mixed.id);
    const payload = {
      tripId: trip.id,
      customerId: "ravi",
      destination: "Mysuru",
      ids: [c.id],
    };
    const second = await session("admin@kriyantha.test", password);
    const r = await Promise.all([
      cmd("allocate", payload),
      cmd("allocate", payload, second),
    ]);
    assert.equal(r.filter((x) => x.status === 200).length, 1);
    const sh = r.find((x) => x.status === 200).data;
    await ok("releaseShipment", {
      id: sh.id,
      reason: "Concurrency test completed",
    });
  });
  await test("partial shipment reserves subset and preserves remainder", async () => {
    shipment = await ok("allocate", {
      tripId: trip.id,
      customerId: "ravi",
      destination: "Mysuru",
      ids: [mixed.id, cartons.find((c) => c.id !== mixed.id).id],
    });
    const st = await state();
    assert.equal(
      st.allocations.filter((a) => a.shipmentId === shipment.id && a.active)
        .length,
      2,
    );
    assert.equal(
      st.cartons.filter(
        (c) => c.manifestId === manifest.id && c.state === "Available",
      ).length,
      8,
    );
    loading = await ok("startLoading", {
      shipmentId: shipment.id,
      station: "TEST-" + runId,
    });
  });
  const scan = (c = mixed, rev = 1, loadingId = loading.id) => ({
    sessionId: loadingId,
    station: "TEST-" + runId,
    qr: `K1|demo|${c.id}|${rev}`,
    mode: "live",
  });
  await test("wrong shipment cartons are rejected", async () => {
    const st = await state();
    const allocated = st.allocations
      .filter((a) => a.shipmentId === shipment.id)
      .map((a) => a.cartonId);
    const unallocated = cartons.find((c) => !allocated.includes(c.id));
    const r = await ok("scan", scan(unallocated));
    assert.equal(r.outcome, "Rejected");
  });
  await test("wrong-company QR, obsolete QR and product barcodes are rejected", async () => {
    for (const qr of [
      `K1|wrong|${mixed.id}|1`,
      `K1|demo|${mixed.id}|2`,
      "SND01",
    ])
      assert.equal((await ok("scan", { ...scan(), qr })).outcome, "Rejected");
  });
  await test("offline replay and wrong workstation are blocked", async () => {
    assert.equal(
      (await cmd("scan", { ...scan(), mode: "offline" })).status,
      400,
    );
    assert.equal(
      (await cmd("scan", { ...scan(), station: "WRONG-STATION" })).status,
      409,
    );
  });
  await test("twenty simultaneous scan attempts accept one mixed carton exactly once", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => cmd("scan", scan())),
    );
    assert.equal(
      responses.filter((r) => r.data?.outcome === "Accepted").length,
      1,
    );
    assert.equal(
      responses.filter((r) => r.data?.outcome === "Duplicate").length,
      19,
    );
    const st = await state();
    assert.equal(
      st.allocations.filter(
        (a) => a.shipmentId === shipment.id && a.state === "Loaded",
      ).length,
      1,
    );
  });
  await test("committed scan response can be recovered by stable request ID", async () => {
    const id = randomUUID();
    const r = await ok("scan", scan(), admin, id);
    assert.equal(r.outcome, "Duplicate");
    const saved = await call(admin, "/requests/" + id);
    assert.deepEqual(saved.data, r);
    assert.deepEqual(await ok("scan", scan(), admin, id), r);
  });
  await test("authoritative state survives browser refresh/new session", async () => {
    const fresh = await session("admin@kriyantha.test", password);
    const st = await call(fresh, "/state");
    assert.equal(
      st.data.cartons.find((c) => c.id === mixed.id).state,
      "Loaded",
    );
  });
  await test("incomplete loading cannot be approved", async () =>
    assert.equal(
      (await cmd("approveLoad", { id: shipment.id, physicalConfirmed: true }))
        .status,
      400,
    ));
  await test("unloading adds compensating event and permits legitimate reload", async () => {
    await ok("unload", {
      id: mixed.id,
      shipmentId: shipment.id,
      reason: "Physical test unload",
    });
    assert.equal(
      (await state()).cartons.find((c) => c.id === mixed.id).state,
      "Reserved",
    );
    assert.equal((await ok("scan", scan())).outcome, "Accepted");
  });
  await test("loader role cannot edit pricing or approve loads", async () => {
    const pw = "Test-only-" + randomUUID();
    const email = "loader-" + runId + "@example.test";
    await ok("createUser", {
      name: "Test Loader",
      email,
      password: pw,
      roles: ["Loader"],
    });
    const u = await session(email, pw);
    assert.equal(
      (
        await cmd(
          "saveBilling",
          {
            shipmentId: shipment.id,
            rates: [],
            freight: 0,
            otherCharges: 0,
            reason: "Forbidden",
            terms: "",
            version: 0,
          },
          u,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await cmd(
          "approveLoad",
          { id: shipment.id, physicalConfirmed: true },
          u,
        )
      ).status,
      403,
    );
  });
  await test("exact subset load approval freezes ordinary unloading", async () => {
    const st = await state();
    const c = st.cartons.find((c) =>
      st.allocations.some(
        (a) =>
          a.shipmentId === shipment.id &&
          a.cartonId === c.id &&
          a.state === "Reserved",
      ),
    );
    assert.equal((await ok("scan", scan(c))).outcome, "Accepted");
    await ok("approveLoad", { id: shipment.id, physicalConfirmed: true });
    assert.equal(
      (
        await cmd("unload", {
          id: mixed.id,
          shipmentId: shipment.id,
          reason: "Too late",
        })
      ).status,
      400,
    );
  });
  await test("pricing edits create new revision and invalidate prior approval", async () => {
    const draft = {
      shipmentId: shipment.id,
      rates: [
        { sku: "SND01", rate: "10", discountPercent: "0" },
        { sku: "ROS01", rate: "12", discountPercent: "0" },
      ],
      freight: "0",
      otherCharges: "0",
      reason: "Illustrative test values only",
      terms: "Test",
      version: 0,
    };
    const b1 = await ok("saveBilling", draft);
    await ok("approveBilling", { id: b1.id, physicalConfirmed: true });
    approvedBill = await ok("saveBilling", {
      ...draft,
      freight: "5",
      version: 1,
    });
    const st = await state();
    assert.equal(
      st.billings.find((b) => b.id === approvedBill.id).approved,
      false,
    );
    assert.equal(
      (await cmd("approveBilling", { id: b1.id, physicalConfirmed: true }))
        .status,
      400,
    );
  });
  await test("unresolved Tally contract produces blocked job without posting", async () => {
    await ok("approveBilling", {
      id: approvedBill.id,
      physicalConfirmed: true,
    });
    const job = await ok("queueInvoice", { id: shipment.id });
    assert.equal(job.state, "Blocked");
    assert.equal((await state()).postingEnabled, false);
  });
  await test("billing cannot mutate while a posting job exists", async () =>
    assert.equal(
      (
        await cmd("saveBilling", {
          shipmentId: shipment.id,
          rates: [],
          freight: 0,
          otherCharges: 0,
          reason: "Unsafe edit",
          terms: "",
          version: 2,
        })
      ).status,
      400,
    ));
  await test("vehicle departure blocks missing confirmed invoice/documents", async () =>
    assert.equal(
      (await cmd("depart", { id: trip.id, physicalConfirmed: true })).status,
      400,
    ));
  await test("pairing rejects wrong-company heartbeat and revocation is enforced", async () => {
    const c = await ok("pairConnector", {
      name: "Fixture connector",
      expectedCompany: "ISOLATED TEST ONLY",
    });
    const send = (company) =>
      fetch(base + "/api/connector/heartbeat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Connector-Id": c.id,
          "X-Connector-Key": c.secret,
        },
        body: JSON.stringify({
          company,
          environment: "Test",
          tallyReachable: false,
          version: "Unknown",
          detail: "Simulated stopped Tally",
        }),
      });
    assert.equal((await send("WRONG COMPANY")).status, 409);
    assert.equal((await send("ISOLATED TEST ONLY")).status, 200);
    await ok("revokeConnector", { id: c.id, reason: "Fixture completed" });
    assert.equal((await send("ISOLATED TEST ONLY")).status, 401);
  });
  if (db) {
    await test("database unique active allocation protects concurrent consumers", async () => {
      const allocation = (
        await db.query(
          'SELECT * FROM "Allocations" WHERE "CartonId"=$1 AND "Active"=true',
          [mixed.id],
        )
      ).rows[0];
      await assert.rejects(
        db.query(
          'INSERT INTO "Allocations" ("Id","CompanyId","ShipmentId","CartonId","State","Active") VALUES ($1,$2,$3,$4,$5,true)',
          [randomUUID(), "demo", allocation.ShipmentId, mixed.id, "Reserved"],
        ),
        (e) => e.code === "23505",
      );
    });
    await test("database audit trigger rejects updates and deletes", async () => {
      for (const query of [
        'UPDATE "Audit" SET "Action"=\'tamper\' WHERE "Id"=(SELECT "Id" FROM "Audit" LIMIT 1)',
        'DELETE FROM "Audit" WHERE "Id"=(SELECT "Id" FROM "Audit" LIMIT 1)',
      ])
        await assert.rejects(db.query(query), /append-only/);
    });
    await test("session expiry stops access", async () => {
      const expired = await session("admin@kriyantha.test", password);
      const tokenHash = (await import("node:crypto"))
        .createHash("sha256")
        .update(expired.cookie.split("=")[1])
        .digest("hex")
        .toUpperCase();
      await db.query(
        'UPDATE "Sessions" SET "Expires"=now()-interval \'1 minute\' WHERE "TokenHash"=$1',
        [tokenHash],
      );
      assert.equal((await call(expired, "/state")).status, 401);
    });
    await test("cross-company actor cannot read or mutate demo identities", async () => {
      const userId = randomUUID();
      await db.query(
        'INSERT INTO "Companies" ("Id","Name","Environment") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        ["other-test", "Other isolated company", "Test"],
      );
      const source = (
        await db.query(
          'SELECT "PasswordHash" FROM "Users" WHERE "Id"=\'admin\'',
        )
      ).rows[0];
      const email = "other-" + runId + "@example.test";
      await db.query(
        'INSERT INTO "Users" ("Id","CompanyId","Email","Name","PasswordHash","Roles","Active") VALUES ($1,$2,$3,$4,$5,$6,true)',
        [
          userId,
          "other-test",
          email,
          "Other company",
          source.PasswordHash,
          ["Admin"],
        ],
      );
      const other = await session(email, password);
      assert.equal(
        (
          await cmd(
            "holdCarton",
            { id: mixed.id, held: true, reason: "Forbidden cross-company" },
            other,
          )
        ).status,
        404,
      );
    });
    await test("accepted scan and compensating unload remain auditable", async () => {
      const r = await db.query(
        'SELECT "Action","Data" FROM "Audit" WHERE "CompanyId"=\'demo\' AND "Data" LIKE $1',
        ["%" + mixed.id + "%"],
      );
      assert.ok(
        r.rows.some(
          (x) =>
            x.Action === "scan" &&
            JSON.parse(x.Data).result.outcome === "Accepted",
        ),
      );
      assert.ok(r.rows.some((x) => x.Action === "unload"));
    });
  }
  console.log(
    JSON.stringify(
      {
        tests: results.length,
        passed: results.filter((x) => x.status === "PASS").length,
        runId,
        postgresVerified: !!db,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  if (db) await db.end();
}
