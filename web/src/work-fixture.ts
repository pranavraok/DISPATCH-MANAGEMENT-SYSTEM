import { sampleState } from "./sample";

// Fictional records used only by automated tests.
export function workFixture() {
  const s = sampleState();
  const contents = JSON.stringify([{ sku: "SND01", quantity: 10, unit: "packets" }]);
  s.customers = [{ id: "customer-one", name: "Customer One" }, { id: "customer-two", name: "Customer Two" }];
  s.manifests = [
    { id: "PACK-A", name: "Packing Alpha", state: "Approved", version: 1, groups: JSON.stringify([{ marking: "A", count: 4, lines: JSON.parse(contents) }]) },
    { id: "PACK-B", name: "Packing Beta", state: "Approved", version: 1, customerId: "customer-one", groups: JSON.stringify([{ marking: "B", count: 1, lines: JSON.parse(contents) }]) },
  ];
  s.trips = [{ id: "TRIP-A", vehicle: "KA-01-ALPHA", driver: "Driver Alpha", state: "Open" }, { id: "TRIP-B", vehicle: "KA-02-BETA", driver: "Driver Beta", state: "Open" }];
  s.shipments = [
    { id: "SHIP-A", tripId: "TRIP-A", customerId: "customer-one", destination: "North depot", state: "Loading", billingVersion: 1 },
    { id: "SHIP-B", tripId: "TRIP-A", customerId: "customer-two", destination: "East depot", state: "Allocated", billingVersion: 1 },
    { id: "SHIP-C", tripId: "TRIP-B", customerId: "customer-one", destination: "South depot", state: "Allocated", billingVersion: 1 },
  ];
  s.cartons = [
    { id: "CT-ONE", manifestId: "PACK-A", state: "Loaded", marking: "A", lines: contents },
    { id: "CT-TWO", manifestId: "PACK-A", state: "Reserved", marking: "A", lines: contents },
    { id: "CT-THREE", manifestId: "PACK-A", state: "Reserved", marking: "A", lines: contents },
    { id: "CT-FREE", manifestId: "PACK-A", state: "Available", marking: "A", lines: contents },
    { id: "CT-STOCK", manifestId: "PACK-B", state: "Available", marking: "B", lines: contents },
  ].map((c) => ({ ...c, revision: 1, companyId: "demo", warehouseId: "main", verified: true, attached: true }));
  s.allocations = [
    { id: "ALLOC-A", shipmentId: "SHIP-A", cartonId: "CT-ONE", state: "Loaded", active: true },
    { id: "ALLOC-B", shipmentId: "SHIP-B", cartonId: "CT-TWO", state: "Reserved", active: true },
    { id: "ALLOC-C", shipmentId: "SHIP-C", cartonId: "CT-THREE", state: "Reserved", active: true },
  ];
  s.jobs = s.shipments.map((sh) => ({ id: "JOB-" + sh.id, shipmentId: sh.id, state: "Blocked", detail: "Fixture only" }));
  s.billings = s.shipments.map((sh) => ({ id: "BILL-" + sh.id, shipmentId: sh.id, revision: 1, total: 100, snapshot: "{}" }));
  s.labels = [
    { id: "LABEL-A", state: "Prepared", cartonSnapshots: JSON.stringify([s.cartons[0]]) },
    { id: "LABEL-SHARED", state: "Prepared", cartonSnapshots: JSON.stringify([s.cartons[0], s.cartons[2]]) },
    { id: "LABEL-STOCK", state: "Prepared", cartonSnapshots: JSON.stringify([s.cartons[4]]) },
  ];
  s.returns = [{ id: "RETURN-A", shipmentId: "SHIP-A", cartonId: "CT-ONE", lines: contents, state: "Quarantine" }];
  s.audit = [
    { id: "EVENT-A", at: "2026-10-30T10:00:00Z", entityId: "CT-ONE", action: "scan", data: JSON.stringify({ input: { shipmentId: "SHIP-A" } }) },
    { id: "EVENT-B", at: "2026-10-30T10:01:00Z", entityId: "SHIP-B", action: "allocate", data: "{}" },
    { id: "EVENT-PREFIX", at: "2026-10-30T10:02:00Z", entityId: "CT-ONE-OTHER", action: "scan", data: JSON.stringify({ note: "CT-ONE appears in a note, not an exact reference" }) },
  ];
  s.cartonTotal = s.cartons.length;
  s.counts = [{ state: "Available", count: 2 }, { state: "Reserved", count: 2 }, { state: "Loaded", count: 1 }];
  return s;
}
