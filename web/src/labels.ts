import { parse, type Row, type Line } from "./domain";
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
    const qr = await QRCode.toDataURL(
      `K1|${c.companyId}|${c.id}|${c.revision}`,
      { errorCorrectionLevel: "M", margin: 4, width: 400 },
    );
    pdf.addImage(qr, "PNG", x + 2, y + 3, 34, 34);
    pdf.setTextColor(25, 45, 38);
    pdf.setFontSize(7);
    pdf.text("KRIYANTHA / DISPATCH", x + 38, y + 7);
    pdf.setFontSize(8);
    pdf.text(c.id, x + 38, y + 13);
    pdf.setFontSize(7);
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
        ? "TEST PAGE - print at 100% / Actual size"
        : "Packed contents only. Validate in authorised application.",
      x + 3,
      y + 48,
    );
  }
  pdf.save(test ? "A4-label-test.pdf" : "carton-labels.pdf");
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
  pdf.text("KRIYANTHA / Packing list", 15, 20);
  pdf.setFontSize(10);
  pdf.text(
    [
      "Operational document - NOT A TAX INVOICE",
      shipment.id,
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
    const wrapped = pdf.splitTextToSize(c.id + " | " + lines, 180);
    pdf.text(wrapped, 15, y);
    y += wrapped.length * 5 + 3;
  }
  pdf.save(shipment.id + "-packing-list.pdf");
}
