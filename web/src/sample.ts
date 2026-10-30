import type { State } from "./domain";
export function sampleState(): State {
  return {
    company: {
      id: "demo",
      name: "Electro Group of Industries",
      environment: "Read-only sample",
    },
    warehouses: [{ id: "main", name: "Main warehouse" }],
    products: [
      { id: "sandal", sku: "SND01", name: "Sample item A", unit: "packets" },
      { id: "rose", sku: "ROS01", name: "Sample item B", unit: "packets" },
    ],
    customers: [
      { id: "ravi", name: "Ravi Stores · Demo", address: "Mysuru, Karnataka" },
      {
        id: "meena",
        name: "Meena Traders · Demo",
        address: "Bengaluru, Karnataka",
      },
    ],
    manifests: [
      {
        id: "DEMO-50",
        name: "50-carton reference · Fictional",
        state: "Draft",
        version: 1,
        warehouseId: "main",
        groups: JSON.stringify([
          {
            marking: "A",
            count: 20,
            lines: [{ sku: "SND01", quantity: 100, unit: "packets" }],
          },
          {
            marking: "B",
            count: 15,
            lines: [{ sku: "SND01", quantity: 80, unit: "packets" }],
          },
          {
            marking: "C",
            count: 10,
            lines: [{ sku: "ROS01", quantity: 100, unit: "packets" }],
          },
          {
            marking: "D",
            count: 5,
            lines: [
              { sku: "SND01", quantity: 40, unit: "packets" },
              { sku: "ROS01", quantity: 20, unit: "packets" },
            ],
          },
        ]),
        notes:
          "Reference only. Actual boxes still require registration, approval, labels and physical verification.",
      },
    ],
    cartons: [],
    cartonTotal: 0,
    counts: [],
    trips: [],
    shipments: [],
    allocations: [],
    loadingSessions: [],
    billings: [],
    jobs: [],
    labels: [],
    returns: [],
    mapping: {
      expectedCompany: "",
      tallyVersion: "Unknown",
      salesLedger: "",
      voucherType: "Sales",
      contractValidated: false,
      statutoryRequired: true,
    },
    connectors: [],
    audit: [],
    users: [],
    serverTime: new Date().toISOString(),
    postingEnabled: false,
  };
}
