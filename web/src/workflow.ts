import type { Row, State } from "./domain";

export type Workflow = "StockFirst" | "OrderFirst";
export const workflows = {
  StockFirst: {
    title: "Pack before order",
    subtitle: "Manufactured stock. Order pending.",
    description: "Pack and label available stock now. Choose the customer when an order arrives.",
    steps: ["Pack stock", "Print labels", "Receive order", "Choose cartons", "Scan & bill"],
  },
  OrderFirst: {
    title: "Order first",
    subtitle: "Order received. Pack for the customer.",
    description: "Record the customer order first. Pack, label and dispatch cartons for that order.",
    steps: ["Receive order", "Pack for order", "Print labels", "Choose cartons", "Scan & bill"],
  },
} as const;
export function readWorkflow(search = window.location.search): Workflow | null {
  const value = new URLSearchParams(search).get("workflow");
  return value === "StockFirst" || value === "OrderFirst" ? value : null;
}
export function orderCartons(s: State, order: Row) {
  const progress = s.orderProgress?.find(row => row.orderId === order.id);
  if (progress) return progress.assignedCartons as number;
  const shipmentIds = new Set(s.shipments.filter(sh => sh.orderId === order.id && sh.state !== "Cancelled").map(sh => sh.id));
  return s.allocations.filter(a => a.active && shipmentIds.has(a.shipmentId)).length;
}
export function sampleWorkflow(s: State, workflow: Workflow): State {
  if (workflow === "StockFirst") return { ...s, workflow, orders: s.orders ?? [] };
  return { ...s, workflow, orders: [], manifests: [], cartons: [], cartonTotal: 0, counts: [], trips: [], shipments: [], allocations: [], loadingSessions: [], billings: [], jobs: [], labels: [], returns: [], audit: [] };
}
