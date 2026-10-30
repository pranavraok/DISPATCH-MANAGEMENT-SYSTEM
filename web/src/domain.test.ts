import { describe, it, expect } from "vitest";
import {
  parseQr,
  csvRows,
  importGroups,
  totals,
  billNet,
  safeCsv,
} from "./domain";
const products = [
  { sku: "0001", unit: "packets" },
  { sku: "ROS01", unit: "packets" },
];
describe("strict packed imports", () => {
  it("keeps leading-zero SKUs and mixed group contents", () => {
    const x = importGroups(
      csvRows(
        "group,cartons,sku,quantity,unit\nA,2,0001,40,packets\nA,2,ROS01,20,packets",
      ),
      products,
    );
    expect(x.errors).toEqual([]);
    expect(x.groups[0].lines).toHaveLength(2);
    expect(x.groups[0].lines[0].sku).toBe("0001");
  });
  it.each(["0", "-1", "1e3", "NaN", "1.1234567", ""])(
    "rejects invalid quantity %s",
    (q) =>
      expect(
        importGroups(
          csvRows(`group,cartons,sku,quantity,unit\nA,2,0001,${q},packets`),
          products,
        ).errors.length,
      ).toBeGreaterThan(0),
  );
  it("rejects duplicates, inconsistent groups and unknown units", () => {
    for (const text of [
      "A,2,0001,40,packets\nA,2,0001,40,packets",
      "A,2,0001,40,packets\nA,3,ROS01,20,packets",
      "A,2,0001,40,kg",
    ])
      expect(
        importGroups(
          csvRows("group,cartons,sku,quantity,unit\n" + text),
          products,
        ).errors.length,
      ).toBeGreaterThan(0);
  });
  it("parses quoted newlines and rejects unclosed quotes", () => {
    expect(csvRows('"A\nB",2,0001,40,packets')[0][0]).toBe("A\nB");
    expect(() => csvRows('"unclosed')).toThrow();
  });
  it("rejects formulas without executing them", () =>
    expect(
      importGroups(
        csvRows("group,cartons,sku,quantity,unit\n=CMD(),2,0001,40,packets"),
        products,
      ).errors.length,
    ).toBeGreaterThan(0));
});
describe("identity and decimal boundaries", () => {
  it("rejects product, wrong-company and malformed codes", () => {
    for (const qr of [
      "SND01",
      "K1|other|CT-A|1",
      "K1|demo|CT-A|0",
      "K1|demo|CT-A|1|extra",
    ])
      expect(() => parseQr(qr, "demo")).toThrow();
  });
  it("resolves versioned carton QR", () =>
    expect(parseQr("K1|demo|CT-A|2", "demo")).toEqual({
      id: "CT-A",
      revision: 2,
    }));
  it("counts a mixed carton once while summing every line exactly", () =>
    expect(
      totals([
        {
          lines:
            '[{"sku":"0001","quantity":"0.1","unit":"packets"},{"sku":"ROS01","quantity":"20","unit":"packets"}]',
        },
        { lines: '[{"sku":"0001","quantity":"0.2","unit":"packets"}]' },
      ]),
    ).toEqual([
      { sku: "0001", unit: "packets", quantity: "0.3" },
      { sku: "ROS01", unit: "packets", quantity: "20" },
    ]));
  it("rounds decimal billing without binary float errors", () =>
    expect(billNet("3", "0.335", "0")).toBe("1.01"));
  it("protects exported cells against formula injection", () =>
    expect(safeCsv('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"'));
});
