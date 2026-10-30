import { describe, expect, it } from "vitest";
import { groupWork, projectWork, readWorkScope, shipmentName } from "./work";
import { workFixture } from "./work-fixture";

describe("work grouping and record isolation", () => {
  it("keeps different shipments for the same customer separate", () => {
    const s = workFixture();
    const groups = groupWork(s, s.shipments, "shipment");
    expect(groups.map((g) => g.key)).toEqual(["shipment:SHIP-A", "shipment:SHIP-B", "shipment:SHIP-C"]);
    expect(shipmentName(s, "SHIP-A")).toContain("KA-01-ALPHA");
    expect(shipmentName(s, "SHIP-C")).toContain("KA-02-BETA");
  });
  it("isolates the cartons, bills, jobs and returns for one shipment", () => {
    const s = projectWork(workFixture(), { kind: "shipment", id: "SHIP-A" });
    expect(s.cartons.map((x) => x.id)).toEqual(["CT-ONE"]);
    expect(s.jobs.map((x) => x.id)).toEqual(["JOB-SHIP-A"]);
    expect(s.billings.map((x) => x.id)).toEqual(["BILL-SHIP-A"]);
    expect(s.trips.map((x) => x.id)).toEqual(["TRIP-A"]);
    expect(s.returns.map((x) => x.id)).toEqual(["RETURN-A"]);
  });
  it("keeps two orders separate even when customer, vehicle and destination all match", () => {
    const s = workFixture();
    const duplicateCustomerOrder = { ...s.shipments[0], id: "SHIP-D" };
    s.shipments.push(duplicateCustomerOrder);
    const groups = groupWork(s, [s.shipments[0], duplicateCustomerOrder], "shipment");
    expect(groups).toHaveLength(2);
    expect(groups[0].title).toContain("SHIP-A");
    expect(groups[1].title).toContain("SHIP-D");
  });
  it("shows every customer on a selected vehicle trip and excludes other trips", () => {
    const s = projectWork(workFixture(), { kind: "trip", id: "TRIP-A" });
    expect(s.shipments.map((x) => x.id)).toEqual(["SHIP-A", "SHIP-B"]);
    expect(s.cartons.map((x) => x.id)).toEqual(["CT-ONE", "CT-TWO"]);
  });
  it("follows a packing list split across trips and retains its unassigned cartons", () => {
    const s = projectWork(workFixture(), { kind: "packing", id: "PACK-A" });
    expect(s.shipments.map((x) => x.id)).toEqual(["SHIP-A", "SHIP-B", "SHIP-C"]);
    expect(s.cartons.map((x) => x.id)).toContain("CT-FREE");
    expect(s.cartons.map((x) => x.id)).not.toContain("CT-STOCK");
  });
  it("does not assign general/customer-marked stock to a shipment just because the customer matches", () => {
    const s = workFixture();
    expect(groupWork(s, [s.cartons[4]], "carton")[0].key).toBe("packing:PACK-B");
    expect(projectWork(s, { kind: "shipment", id: "SHIP-A" }).cartons.map((x) => x.id)).not.toContain("CT-STOCK");
  });
  it("labels a print job spanning multiple shipments as shared", () => {
    const s = workFixture();
    const groups = groupWork(s, s.labels, "label");
    expect(groups.find((g) => g.rows.some((x) => x.id === "LABEL-SHARED"))?.title).toBe("Shared print jobs");
    expect(groups.find((g) => g.rows.some((x) => x.id === "LABEL-A"))?.key).toBe("shipment:SHIP-A");
  });
  it("uses exact record references for audit filtering instead of ID prefixes", () => {
    const s = projectWork(workFixture(), { kind: "shipment", id: "SHIP-A" });
    expect(s.audit.map((x) => x.id)).toEqual(["EVENT-A"]);
  });
  it("preserves full catalogues and never changes the original data while filtering", () => {
    const raw = workFixture();
    const before = JSON.stringify(raw);
    const selected = projectWork(raw, { kind: "shipment", id: "SHIP-A" });
    expect(selected.products).toBe(raw.products);
    expect(JSON.stringify(raw)).toBe(before);
    expect(projectWork(raw, { kind: "all" })).toBe(raw);
  });
  it("restores a validated work selection from the URL", () => {
    expect(readWorkScope("?work=shipment%3ASHIP-A")).toEqual({ kind: "shipment", id: "SHIP-A" });
    expect(readWorkScope("?work=customer:one")).toEqual({ kind: "all" });
    expect(readWorkScope("?work=shipment:")).toEqual({ kind: "all" });
  });
});
