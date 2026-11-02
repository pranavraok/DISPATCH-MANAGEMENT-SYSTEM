import { parse, type Row, type Line } from "./domain";
import { cartonQr, shortReference } from "./codes";
import { brand } from "./brand";
export async function labelPdf(cartons: Row[], company: string, test = false) {
  const [{ default: QRCode }, { jsPDF }] = await Promise.all([
    import("qrcode"),
    import("jspdf"),
  ]);
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const selected = test ? cartons.slice(0, 1) : cartons;
  if (!selected.length) throw Error("Select cartons to print.");
  for (let i = 0; i < selected.length; i++) {
    if (i > 0 && i % 10 === 0) pdf.addPage();
    const col = i % 2,
      row = Math.floor((i % 10) / 2),
      x = 10 + col * 95,
      y = 12 + row * 54,
      c = selected[i];
    pdf.setDrawColor(190);
    pdf.roundedRect(x, y, 90, 50, 1, 1);
    const payload = cartonQr(c as { id: string; companyId: string; revision: number });
    const qr = await QRCode.toDataURL(
      payload,
      { errorCorrectionLevel: "M", margin: 4, width: 400 },
    );
    pdf.addImage(qr, "PNG", x + 2, y + 3, 34, 34);
    pdf.setTextColor(25, 45, 38);
    pdf.setFontSize(8);
    pdf.text(brand.shortName + " DISPATCH", x + 38, y + 7);
    pdf.setFontSize(10);
    pdf.text(payload.startsWith("Q") ? payload : shortReference(c.id), x + 38, y + 13);
    pdf.setFontSize(8);
    pdf.text(`Revision ${c.revision} | Group ${c.marking}`, x + 38, y + 18);
    const lines = parse<Line[]>(c.lines);
    const text = lines
      .map((l) => `${l.sku}: ${l.quantity} ${l.unit}`)
      .join("\n");
    const wrapped = pdf.splitTextToSize(text, 48);
    if (wrapped.length > 6)
      throw Error(
        `Carton ${c.id} has too many content lines for the default label. Configure a larger label before printing.`,
      );
    pdf.text(wrapped, x + 38, y + 23);
    pdf.setFontSize(6);
    pdf.text(
      pdf.splitTextToSize(company.replace(/[^\x20-\x7E]/g, ""), 84),
      x + 3,
      y + 43,
    );
    pdf.text(
      test
        ? "PRINTER CHECK - print at 100% / Actual size"
        : "Check carton contents in the dispatch app.",
      x + 3,
      y + 48,
    );
  }
  pdf.save(test ? "A4-printer-check.pdf" : "carton-labels.pdf");
}
export function download(name: string, text: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function packingPdf(
  shipment: Row,
  cartons: Row[],
  customer: string,
) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF();
  pdf.setFontSize(17);
  pdf.text(brand.name, 15, 20);
  pdf.setFontSize(10);
  pdf.text(
    [
      "Packing list - NOT A TAX INVOICE",
      shortReference(shipment.id),
      customer,
      shipment.destination,
    ],
    15,
    30,
  );
  let y = 55;
  for (const c of cartons) {
    if (y > 270) {
      pdf.addPage();
      y = 20;
    }
    const lines = parse<Line[]>(c.lines)
      .map((l) => `${l.sku}: ${l.quantity} ${l.unit}`)
      .join(", ");
    const wrapped = pdf.splitTextToSize(shortReference(c.id) + " | " + lines, 180);
    pdf.text(wrapped, 15, y);
    y += wrapped.length * 5 + 3;
  }
  pdf.save(shipment.id + "-packing-list.pdf");
}

export async function invoicePdf(document: Row): Promise<{ blob: Blob; fileName: string }> {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const invoice = document.invoice ?? {};
  const billing = document.billing ?? {};
  const billSnapshot = parse<Row>(billing.snapshot ?? "{}");
  const customer = document.customer ?? {};
  const shipment = document.shipment ?? {};
  const order = document.order ?? {};
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  if (!invoice.voucherNumber || !lines.length)
    throw Error("Tally-confirmed invoice details are incomplete; no PDF was created.");
  const left = 14, right = 196, width = right - left;
  const line = (y: number) => { pdf.setDrawColor(120); pdf.setLineWidth(.25); pdf.line(left, y, right, y); };
  const money = (value: unknown) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value ?? 0));
  const writeWrapped = (text: string, x: number, y: number, maxWidth: number, fontSize = 8) => {
    pdf.setFontSize(fontSize);
    const rows = pdf.splitTextToSize(text, maxWidth) as string[];
    pdf.text(rows, x, y);
    return rows.length * (fontSize * .42 + 1);
  };
  const wordsUnderHundred = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tensWords = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const underThousand = (n: number): string => {
    const parts: string[] = [];
    if (n >= 100) { parts.push(wordsUnderHundred[Math.floor(n / 100)] + " Hundred"); n %= 100; }
    if (n >= 20) { parts.push(tensWords[Math.floor(n / 10)]); n %= 10; }
    if (n > 0) parts.push(wordsUnderHundred[n]);
    return parts.join(" ");
  };
  const amountWords = (value: unknown) => {
    let n = Math.round(Number(value ?? 0) * 100), rupees = Math.floor(n / 100), paise = n % 100;
    if (!Number.isFinite(n) || rupees > 999999999) return "";
    const groups: string[] = [];
    for (const [size, name] of [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"], [1, ""]] as [number, string][]) {
      const group = Math.floor(rupees / size); rupees %= size;
      if (group) groups.push(underThousand(group) + (name ? ` ${name}` : ""));
    }
    return `INR ${groups.join(" ") || "Zero"} Rupees${paise ? ` and ${underThousand(paise)} Paise` : ""} Only`;
  };
  const roundBox = (x: number, y: number, w: number, h: number, title: string) => {
    pdf.setDrawColor(145); pdf.roundedRect(x, y, w, h, 1, 1);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.text(title, x + 3, y + 5);
  };

  // Tally Classic-inspired invoice layout. Values below come from the confirmed Tally voucher and synced masters.
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(16); pdf.text(brand.name, left, 17);
  pdf.setFontSize(13); pdf.text("TAX INVOICE", right, 17, { align: "right" });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
  pdf.text("Sales invoice generated from the confirmed Tally voucher", left, 22);
  line(25);

  const boxY = 28, boxH = 39, gap = 4, boxW = (width - gap) / 2;
  roundBox(left, boxY, boxW, boxH, "BILL TO");
  roundBox(left + boxW + gap, boxY, boxW, boxH, "INVOICE DETAILS");
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
  pdf.text(String(customer.name ?? invoice.partyLedgerName ?? ""), left + 3, boxY + 11);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
  let cy = boxY + 16;
  for (const value of [customer.tallyAddress ?? customer.address, customer.gstIn ? `GSTIN: ${customer.gstIn}` : null]) {
    if (String(value ?? "").trim()) cy += writeWrapped(String(value), left + 3, cy, boxW - 6, 8);
  }
  const metaX = left + boxW + gap + 3;
  const meta = [
    ["Voucher No.", invoice.voucherNumber], ["Invoice date", invoice.date],
    ["Voucher type", invoice.voucherType], ["Reference", invoice.reference],
    ["Order reference", order.reference], ["Order date", order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : ""],
  ].filter(([, value]) => String(value ?? "").trim());
  let my = boxY + 11;
  meta.forEach(([label, value]) => {
    pdf.setFont("helvetica", "bold"); pdf.text(`${label}:`, metaX, my);
    pdf.setFont("helvetica", "normal"); pdf.text(String(value), metaX + 26, my, { maxWidth: boxW - 32 }); my += 5;
  });

  let y = boxY + boxH + 5;
  const delivery = String(order.destination ?? shipment.destination ?? "").trim();
  const dispatchParts = [delivery && `Delivery to: ${delivery}`].filter(Boolean);
  if (dispatchParts.length) {
    roundBox(left, y, width, 14, "DELIVERY");
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
    writeWrapped(dispatchParts.join("  |  "), left + 3, y + 10, width - 6, 8);
    y += 18;
  }
  const terms = String(billSnapshot.terms ?? "").trim();
  if (terms) {
    const wrapped = pdf.splitTextToSize(terms, width - 6) as string[];
    const h = Math.max(14, wrapped.length * 4 + 9);
    roundBox(left, y, width, h, "TERMS"); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.text(wrapped, left + 3, y + 10); y += h + 4;
  }
  if (document.demoTaxSetup) {
    pdf.setTextColor(155, 80, 25); pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
    pdf.text("ACCOUNTANT REVIEW REQUIRED: connected Tally tax ledgers are marked DEMO.", left, y + 3);
    pdf.setTextColor(0); pdf.setFont("helvetica", "normal"); y += 8;
  }
  y += 2;

  const widths = [8, 47, 20, 18, 18, 13, 20, 14, 24];
  const headers = ["#", "Description of goods", "HSN/SAC", "Quantity", "Rate (INR)", "Disc. %", "Taxable (INR)", "GST", "Amount (INR)"];
  const xPositions = [left]; widths.forEach((w) => xPositions.push(xPositions[xPositions.length - 1] + w));
  const drawHeader = () => {
    pdf.setFillColor(225, 233, 241); pdf.rect(left, y - 4, width, 9, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(7);
    headers.forEach((h, i) => pdf.text(h, xPositions[i] + (i > 2 ? widths[i] - 1 : 1), y + 1, { align: i > 2 ? "right" : "left" }));
    pdf.setFont("helvetica", "normal"); y += 8;
  };
  const pageFooter = (pageNo: number) => {
    pdf.setFontSize(7); pdf.setTextColor(90); pdf.text(`${brand.name} · Invoice ${invoice.voucherNumber}`, left, 289);
    pdf.text(`Page ${pageNo}`, right, 289, { align: "right" }); pdf.setTextColor(0);
  };
  drawHeader();
  const hsnGroups = new Map<string, { taxable: number; rate: number }>();
  lines.forEach((item: Row, index: number) => {
    const amount = Number(item.amount ?? 0), quantity = Number(item.quantity ?? 0), rate = Number(item.rate ?? (quantity ? amount / quantity : 0)), discountPercent = Number(item.discountPercent ?? 0);
    const key = `${String(item.hsnCode ?? "")}|${Number(item.gstRate ?? 0)}`;
    const group = hsnGroups.get(key) ?? { taxable: 0, rate: Number(item.gstRate ?? 0) };
    group.taxable += amount; hsnGroups.set(key, group);
    const desc = pdf.splitTextToSize(String(item.stockItemName ?? ""), widths[1] - 3) as string[];
    const rowHeight = Math.max(8, desc.length * 4 + 3);
    if (y + rowHeight > 267) { pageFooter(pdf.getNumberOfPages()); pdf.addPage(); y = 18; drawHeader(); }
    const qty = `${item.quantity ?? ""} ${item.unit ?? ""}`.trim();
    pdf.setFontSize(7.5);
    pdf.text(String(index + 1), xPositions[0] + 1, y);
    pdf.text(desc, xPositions[1] + 1, y);
    pdf.text(String(item.hsnCode ?? ""), xPositions[2] + 1, y);
    pdf.text(qty, xPositions[3] + widths[3] - 1, y, { align: "right" });
    pdf.text(money(rate), xPositions[4] + widths[4] - 1, y, { align: "right" });
    pdf.text(discountPercent ? `${discountPercent}%` : "—", xPositions[5] + widths[5] - 1, y, { align: "right" });
    pdf.text(money(amount), xPositions[6] + widths[6] - 1, y, { align: "right" });
    pdf.text(`${Number(item.gstRate ?? 0)}%`, xPositions[7] + widths[7] - 1, y, { align: "right" });
    const gross = amount * (1 + Number(item.gstRate ?? 0) / 100);
    pdf.text(money(gross), xPositions[8] + widths[8] - 1, y, { align: "right" });
    pdf.setDrawColor(185); pdf.line(left, y + rowHeight - 2, right, y + rowHeight - 2); y += rowHeight;
  });
  y += 4;

  // Actual invoice totals are read from Tally. HSN rows show the synced item taxable values and rates.
  const summaryRows: [string, unknown][] = [];
  if (Number(billSnapshot.freight ?? 0) > 0) summaryRows.push(["Freight", billSnapshot.freight]);
  if (Number(billSnapshot.otherCharges ?? 0) > 0) summaryRows.push(["Other charges", billSnapshot.otherCharges]);
  summaryRows.push(["Taxable value", invoice.taxable]);
  if (Number(invoice.cgst) > 0) summaryRows.push(["CGST", invoice.cgst]);
  if (Number(invoice.sgst) > 0) summaryRows.push(["SGST", invoice.sgst]);
  if (Number(invoice.igst) > 0) summaryRows.push(["IGST", invoice.igst]);
  summaryRows.push(["Invoice total", invoice.total]);
  const summaryH = 8 + summaryRows.length * 5 + 4;
  if (y + summaryH > 266) { pageFooter(pdf.getNumberOfPages()); pdf.addPage(); y = 18; }
  const summaryX = 111, summaryW = right - summaryX;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.text("TAX SUMMARY", left, y + 4);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
  pdf.text("HSN/SAC", left, y + 10); pdf.text("Taxable", left + 48, y + 10, { align: "right" }); pdf.text("Rate", left + 64, y + 10, { align: "right" });
  let sy = y + 15;
  for (const [key, value] of hsnGroups) {
    const [hsn, rate] = key.split("|");
    pdf.text(hsn || "—", left, sy); pdf.text(money(value.taxable), left + 48, sy, { align: "right" }); pdf.text(`${rate}%`, left + 64, sy, { align: "right" }); sy += 4.5;
  }
  pdf.setDrawColor(150); pdf.roundedRect(summaryX, y, summaryW, summaryH, 1, 1);
  let ty = y + 7;
  summaryRows.forEach(([label, value], index) => {
    if (index === summaryRows.length - 1) { pdf.setFont("helvetica", "bold"); pdf.setDrawColor(130); pdf.line(summaryX + 2, ty - 2, right - 2, ty - 2); }
    pdf.text(label, summaryX + 3, ty); pdf.text(money(value), right - 3, ty, { align: "right" }); pdf.setFont("helvetica", "normal"); ty += 5;
  });
  y += summaryH + 4;

  const words = amountWords(invoice.total);
  if (words) { pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.5); pdf.text("Amount in words:", left, y + 3); pdf.setFont("helvetica", "normal"); writeWrapped(words, left + 28, y + 3, width - 30, 7.5); y += 8; }
  const declaration = "Declaration: The particulars shown above are as recorded in the confirmed Tally sales voucher.";
  const declarationHeight = writeWrapped(declaration, left, y + 4, width - 65, 7.5);
  pdf.setDrawColor(150); pdf.roundedRect(left, y, width, Math.max(24, declarationHeight + 17), 1, 1);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.5); pdf.text("Declaration", left + 3, y + 5);
  pdf.setFont("helvetica", "normal"); pdf.text(pdf.splitTextToSize(declaration, width - 72), left + 3, y + 10);
  pdf.text(`For ${brand.name}`, right - 3, y + 10, { align: "right" });
  pdf.line(right - 43, y + 19, right - 3, y + 19); pdf.setFontSize(7); pdf.text("Authorised signatory", right - 3, y + 23, { align: "right" });
  pageFooter(pdf.getNumberOfPages());
  return {
    blob: pdf.output("blob"),
    fileName: `${String(invoice.voucherNumber).replace(/[^a-z0-9_-]/gi, "_")}-invoice.pdf`,
  };
}
