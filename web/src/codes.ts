const cartonId = /^CT-([0-9A-F]{20})$/;
const compactQr = /^Q([A-Za-z0-9_-]{14})\.([0-9A-Z]{1,6})$/;
const referencePrefixes: Record<string, string> = { PK: "P", TR: "T", SH: "S", CT: "C" };

function encodeHex(hex: string) {
  return btoa(String.fromCharCode(...hex.match(/../g)!.map((pair) => parseInt(pair, 16))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Reversible display reference. No identity bits are truncated or regenerated. */
export function shortReference(id: string) {
  const match = /^(PK|TR|SH|CT)-([0-9A-F]{20})$/.exec(id);
  return match ? referencePrefixes[match[1]] + encodeHex(match[2]) : id;
}

/** Compact QR keeps the full 80-bit carton identity and the label revision. */
export function cartonQr(carton: { id: string; companyId: string; revision: number }) {
  const match = cartonId.exec(carton.id);
  if (!Number.isInteger(carton.revision) || carton.revision < 1 || carton.revision > 2147483647) throw Error("Invalid label revision.");
  return match ? `Q${encodeHex(match[1])}.${carton.revision.toString(36).toUpperCase()}` : `K1|${carton.companyId}|${carton.id}|${carton.revision}`;
}

export function decodeCompactQr(qr: string): { id: string; revision: number } | null {
  const match = compactQr.exec(qr);
  if (!match) return null;
  const raw = atob(match[1].replaceAll("-", "+").replaceAll("_", "/") + "==");
  const hex = Array.from(raw, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();
  const revision = parseInt(match[2], 36);
  if (raw.length !== 10 || encodeHex(hex) !== match[1] || revision < 1 || revision > 2147483647 || revision.toString(36).toUpperCase() !== match[2]) return null;
  return { id: "CT-" + hex, revision };
}
