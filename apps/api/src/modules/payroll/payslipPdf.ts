import PDFDocument from 'pdfkit';

export interface PayslipPdfInput {
  companyName: string;
  month: string; // YYYY-MM
  currency: string;
  employee: { code?: string | null; name?: string | null; designation?: string | null; department?: string | null };
  attendance?: { daysInMonth?: number | null; payableDays?: number | null; lopDays?: number | null } | null;
  lines: { code?: string | null; name?: string | null; kind?: string | null; amountMinor?: number | null }[];
  grossMinor: number;
  deductionsMinor: number;
  netMinor: number;
  employerLines?: { name?: string | null; amountMinor?: number | null }[];
  draft: boolean;
}

/** The built-in PDF fonts only cover Latin-1; anything else would print as garbage, so show "?" instead. */
export const latin = (s: string | null | undefined): string =>
  (s ?? '').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

export function formatMinor(minor: number, currency: string): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${currency} ${neg ? "-" : ""}${whole}.${String(abs % 100).padStart(2, '0')}`;
}

export function renderPayslipPdf(d: PayslipPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Payslip ${d.month}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const money = (n: number | null | undefined) => formatMinor(n ?? 0, d.currency);

    doc.font('Helvetica-Bold').fontSize(16).text(latin(d.companyName), left, 48);
    doc.font('Helvetica').fontSize(11).text(`Payslip for ${d.month}`);
    if (d.draft) doc.fillColor('#b45309').text('DRAFT - not yet published').fillColor('black');
    doc.moveDown();

    const info: [string, string][] = [
      ['Employee', latin(d.employee.name)],
      ['Code', latin(d.employee.code)],
      ['Designation', latin(d.employee.designation)],
      ['Department', latin(d.employee.department)],
    ];
    if (d.attendance)
      info.push([
        'Days',
        `${d.attendance.payableDays ?? 0} payable of ${d.attendance.daysInMonth ?? 0} (loss of pay: ${d.attendance.lopDays ?? 0})`,
      ]);
    for (const [k, v] of info) {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(10).text(k, left, y, { width: 100 });
      doc.font('Helvetica').text(v || '-', left + 110, y, { width: width - 110 });
    }
    doc.moveDown();

    const table = (title: string, rows: { name: string; amount: number }[]) => {
      doc.font('Helvetica-Bold').fontSize(11).text(title, left, doc.y);
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
      doc.moveDown(0.3);
      if (!rows.length) doc.font('Helvetica').fontSize(10).text('None');
      for (const r of rows) {
        const y = doc.y;
        doc.font('Helvetica').fontSize(10).text(latin(r.name), left, y, { width: width - 140 });
        doc.text(money(r.amount), left + width - 140, y, { width: 140, align: 'right' });
      }
      doc.moveDown();
    };
    const rows = (kind: string) =>
      d.lines
        .filter((l) => l.kind === kind && (l.amountMinor ?? 0) !== 0)
        .map((l) => ({ name: l.name || l.code || '', amount: l.amountMinor ?? 0 }));
    table('Earnings', rows('EARNING'));
    table('Deductions', rows('DEDUCTION'));

    const total = (label: string, n: number, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 10);
      doc.text(label, left, y, { width: width - 140 });
      doc.text(money(n), left + width - 140, y, { width: 140, align: 'right' });
    };
    total('Gross earnings', d.grossMinor);
    total('Total deductions', d.deductionsMinor);
    total('Net pay', d.netMinor, true);

    const employer = (d.employerLines ?? []).filter((l) => (l.amountMinor ?? 0) !== 0);
    if (employer.length) {
      doc.moveDown();
      table(
        'Employer contributions (paid by the company, not deducted from your pay)',
        employer.map((l) => ({ name: l.name ?? '', amount: l.amountMinor ?? 0 })),
      );
    }

    doc.moveDown().font('Helvetica').fontSize(8).fillColor('#555555');
    doc.text('This is a system-generated payslip.', left);
    doc.end();
  });
}
