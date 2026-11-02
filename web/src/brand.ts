import { site } from "./site";
export const brand = {
  get name() { return site?.companyName ?? "Electro Group of Industries"; },
  get business() { return site?.slug === "aromazon" ? "Dispatch workspace" : "Dispatch management"; },
  get shortName() { return site?.shortName ?? "ELECTRO"; },
  get email() { return site?.email ?? "admin@electrogroup.test"; },
  get tagline() { return site?.tagline ?? "GROUP OF INDUSTRIES"; },
  get initial() { return site?.shortName.charAt(0) ?? "E"; },
};

const labels: Record<string, string> = {
  PackingClerk: "Packing staff",
  PackingSupervisor: "Packing supervisor",
  DispatchSupervisor: "Dispatch supervisor",
  Loader: "Loading staff",
  Billing: "Billing staff",
  Admin: "Administrator",
  MD: "Management (view only)",
  LoadApproved: "Load approved",
  BillingDraft: "Bill draft",
  BillingApproved: "Bill approved",
  InvoiceCompleted: "Invoice completed",
  Completed: "Completed",
  InvoiceBlocked: "Waiting for Tally confirmation",
  Blocked: "Waiting for Tally confirmation",
  Unvalidated: "Not checked",
  Allocated: "Boxes reserved",
  Quarantine: "Keep separate",
  Disposal: "For disposal",
  AwaitingAccountingRestock: "Waiting for accounts",
  OperatorConfirmed: "Printed and checked",
  ConfirmationUnknown: "Result needs checking",
  NeedsReview: "Needs checking",
  Uninspected: "Not checked yet",
  Accepted: "Loaded",
  Duplicate: "Already loaded",
  Rejected: "Not loaded",
  Pending: "Please wait",
};

export function plainLabel(value: string): string {
  return labels[value] ?? value.replace(/([a-z])([A-Z])/g, "$1 $2");
}
