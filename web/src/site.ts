import type { Workflow } from "./workflow";

export type Site = { slug: string; companyId: string; companyName: string; shortName: string; tagline: string; email: string; workflow: Workflow };
export let site: Site | null = null;
export function configureSite(value: Site | null) {
  if (value && (!["electro", "aromazon"].includes(value.slug) || !["StockFirst", "OrderFirst"].includes(value.workflow))) throw Error("Invalid company configuration.");
  site = value;
}
