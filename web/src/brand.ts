export const brand = {
  name: "Electro Group of Industries",
  business: "Electrotech Services",
  shortName: "ELECTRO",
  email: "admin@electrogroup.test",
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
  InvoiceBlocked: "Waiting for Tally setup",
  Blocked: "Waiting for Tally setup",
  Unvalidated: "Not checked",
  Allocated: "Cartons reserved",
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
