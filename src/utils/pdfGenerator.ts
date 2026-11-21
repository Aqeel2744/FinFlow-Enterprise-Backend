import PDFDocument from 'pdfkit';
import { centsToDollars, formatCents } from './currency.js';

export interface InvoicePdfData {
  invoiceNumber: string;
  status: string;
  issueDate: Date | string;
  dueDate: Date | string;
  currency: string;
  subtotalCents: bigint | number;
  discountCents: bigint | number;
  taxCents: bigint | number;
  totalCents: bigint | number;
  paidCents: bigint | number;
  balanceCents: bigint | number;
  notes?: string | null;
  terms?: string | null;
  organization: {
    name: string;
    taxId?: string | null;
    address?: string | null;
    phone?: string | null;
  };
  customer: {
    name: string;
    email: string;
    taxNumber?: string | null;
    billingAddress?: string | null;
  };
  items: Array<{
    description: string;
    quantity: number;
    unitPriceCents: bigint | number;
    discountPercent: number | any;
    taxPercent: number | any;
    totalCents: bigint | number;
  }>;
}

export function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });

      // Colors
      const primaryColor = '#0f172a'; // slate-900
      const accentColor = '#16a34a';  // green-600
      const secondaryColor = '#64748b';// slate-500

      // Header
      doc
        .fillColor(primaryColor)
        .fontSize(22)
        .font('Helvetica-Bold')
        .text('FINFLOW', 50, 45)
        .fontSize(10)
        .font('Helvetica')
        .fillColor(secondaryColor)
        .text('Enterprise Financial Suite', 50, 70);

      // Organization details (Top Right)
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(data.organization.name, 300, 45, { align: 'right' })
        .font('Helvetica')
        .fontSize(9)
        .fillColor(secondaryColor);

      if (data.organization.address) {
        doc.text(data.organization.address, 300, 60, { align: 'right' });
      }
      if (data.organization.taxId) {
        doc.text(`Tax ID: ${data.organization.taxId}`, 300, 75, { align: 'right' });
      }

      doc.moveDown();
      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, 100).lineTo(550, 100).stroke();

      // Invoice Details & Customer Info
      const startY = 120;
      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(`INVOICE: ${data.invoiceNumber}`, 50, startY)
        .fontSize(9)
        .font('Helvetica')
        .fillColor(secondaryColor)
        .text(`Status: ${data.status}`, 50, startY + 22)
        .text(`Issue Date: ${new Date(data.issueDate).toLocaleDateString()}`, 50, startY + 36)
        .text(`Due Date: ${new Date(data.dueDate).toLocaleDateString()}`, 50, startY + 50);

      // Bill To
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('BILLED TO:', 320, startY)
        .font('Helvetica')
        .fontSize(10)
        .text(data.customer.name, 320, startY + 16)
        .fontSize(9)
        .fillColor(secondaryColor)
        .text(data.customer.email, 320, startY + 30);

      if (data.customer.billingAddress) {
        doc.text(data.customer.billingAddress, 320, startY + 44);
      }
      if (data.customer.taxNumber) {
        doc.text(`Customer Tax ID: ${data.customer.taxNumber}`, 320, startY + 58);
      }

      // Line items table
      let tableY = startY + 90;
      doc.rect(50, tableY, 500, 22).fill('#f8fafc');

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(primaryColor)
        .text('DESCRIPTION', 60, tableY + 6)
        .text('QTY', 270, tableY + 6, { width: 40, align: 'right' })
        .text('UNIT PRICE', 320, tableY + 6, { width: 70, align: 'right' })
        .text('TAX %', 400, tableY + 6, { width: 40, align: 'right' })
        .text('TOTAL', 450, tableY + 6, { width: 90, align: 'right' });

      tableY += 25;
      doc.font('Helvetica').fontSize(9).fillColor(primaryColor);

      data.items.forEach((item) => {
        doc
          .text(item.description, 60, tableY, { width: 200 })
          .text(item.quantity.toString(), 270, tableY, { width: 40, align: 'right' })
          .text(formatCents(item.unitPriceCents, data.currency), 320, tableY, { width: 70, align: 'right' })
          .text(`${Number(item.taxPercent)}%`, 400, tableY, { width: 40, align: 'right' })
          .text(formatCents(item.totalCents, data.currency), 450, tableY, { width: 90, align: 'right' });

        tableY += 20;
      });

      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, tableY).lineTo(550, tableY).stroke();
      tableY += 15;

      // Totals Box
      const totalsX = 350;
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(secondaryColor)
        .text('Subtotal:', totalsX, tableY)
        .text(formatCents(data.subtotalCents, data.currency), 450, tableY, { width: 90, align: 'right' });

      tableY += 16;
      if (Number(data.discountCents) > 0) {
        doc
          .text('Discount:', totalsX, tableY)
          .text(`-${formatCents(data.discountCents, data.currency)}`, 450, tableY, { width: 90, align: 'right' });
        tableY += 16;
      }

      doc
        .text('Tax:', totalsX, tableY)
        .text(formatCents(data.taxCents, data.currency), 450, tableY, { width: 90, align: 'right' });

      tableY += 16;
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(primaryColor)
        .text('Total Due:', totalsX, tableY)
        .text(formatCents(data.totalCents, data.currency), 450, tableY, { width: 90, align: 'right' });

      tableY += 18;
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(accentColor)
        .text('Amount Paid:', totalsX, tableY)
        .text(formatCents(data.paidCents, data.currency), 450, tableY, { width: 90, align: 'right' });

      tableY += 16;
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(Number(data.balanceCents) > 0 ? '#b91c1c' : accentColor)
        .text('Balance Remaining:', totalsX, tableY)
        .text(formatCents(data.balanceCents, data.currency), 450, tableY, { width: 90, align: 'right' });

      // Notes & Terms
      if (data.notes || data.terms) {
        const bottomY = Math.max(tableY + 30, 650);
        doc.strokeColor('#f1f5f9').lineWidth(1).moveTo(50, bottomY - 10).lineTo(550, bottomY - 10).stroke();

        if (data.notes) {
          doc
            .font('Helvetica-Bold')
            .fontSize(8)
            .fillColor(primaryColor)
            .text('NOTES:', 50, bottomY)
            .font('Helvetica')
            .fillColor(secondaryColor)
            .text(data.notes, 50, bottomY + 12, { width: 450 });
        }
        if (data.terms) {
          doc
            .font('Helvetica-Bold')
            .fontSize(8)
            .fillColor(primaryColor)
            .text('TERMS & CONDITIONS:', 50, bottomY + 40)
            .font('Helvetica')
            .fillColor(secondaryColor)
            .text(data.terms, 50, bottomY + 52, { width: 450 });
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
