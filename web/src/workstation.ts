export type Workstation = { station: string };
const key = (company: string) => "electro-group-workstation-v1:" + company;
export function readWorkstation(company = "demo"): Workstation {
  try {
    const value = JSON.parse(localStorage.getItem(key(company)) ?? "null");
    if (typeof value?.station === "string" && value.station.trim().length >= 2 && value.station.length <= 80) return { station: value.station.trim() };
  } catch { /* An unavailable browser store uses the existing safe default. */ }
  return { station: "LOADING-PC-01" };
}
export function saveWorkstation(company: string, station: string) {
  const value = station.trim();
  if (value.length < 2 || value.length > 80) throw Error("Use a workstation name between 2 and 80 characters.");
  localStorage.setItem(key(company), JSON.stringify({ station: value }));
}
