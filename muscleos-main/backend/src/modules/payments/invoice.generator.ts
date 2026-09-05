import { PassThrough } from 'stream';

import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

interface InvoiceData {
  invoiceNumber: string;
  receiptNumber: string;
  date: Date;
  gymName: string;
  gymAddress?: string;
  gymGstNumber?: string;
  memberName: string;
  memberPhone?: string;
  description: string;
  amount: number;
  discount: number;
  gstPercentage?: number;
  tax: number;
  total: number;
  method: string;
  collectedBy?: string;
}

/**
 * Generates a receipt/invoice PDF in-memory and returns a Buffer.
 * Called by PaymentsService after a successful payment; the buffer can be
 * streamed back to the client or uploaded to storage for `invoiceUrl`.
 */
@Injectable()
export class InvoiceGenerator {
  async generate(data: InvoiceData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(c));

    doc.pipe(stream);

    doc.fontSize(20).fillColor('#0f172a').text(data.gymName, { align: 'left' });
    if (data.gymAddress) doc.fontSize(9).fillColor('#475569').text(data.gymAddress);
    if (data.gymGstNumber) doc.fontSize(9).text(`GSTIN: ${data.gymGstNumber}`);
    doc.moveDown(1.5);

    doc.fontSize(14).fillColor('#0f172a').text('Payment Receipt / Invoice', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#334155');
    doc.text(`Invoice No: ${data.invoiceNumber}`);
    doc.text(`Receipt No: ${data.receiptNumber}`);
    doc.text(`Date: ${data.date.toLocaleDateString('en-IN')}`);
    doc.moveDown(1);

    doc.fontSize(11).fillColor('#0f172a').text('Billed To');
    doc.fontSize(10).fillColor('#334155').text(data.memberName);
    if (data.memberPhone) doc.text(data.memberPhone);
    doc.moveDown(1);

    const tableTop = doc.y + 10;
    doc.fontSize(10).fillColor('#0f172a');
    doc.text('Description', 50, tableTop);
    doc.text('Amount', 400, tableTop, { width: 100, align: 'right' });
    doc.moveTo(50, tableTop + 15).lineTo(500, tableTop + 15).strokeColor('#cbd5e1').stroke();

    let y = tableTop + 25;
    doc.fontSize(10).fillColor('#334155');
    doc.text(data.description, 50, y);
    doc.text(`Rs. ${data.amount.toFixed(2)}`, 400, y, { width: 100, align: 'right' });
    y += 20;

    if (data.discount > 0) {
      doc.text('Discount', 50, y);
      doc.text(`- Rs. ${data.discount.toFixed(2)}`, 400, y, { width: 100, align: 'right' });
      y += 20;
    }
    if (data.tax > 0) {
      doc.text(`GST (${data.gstPercentage ?? 0}%)`, 50, y);
      doc.text(`+ Rs. ${data.tax.toFixed(2)}`, 400, y, { width: 100, align: 'right' });
      y += 20;
    }

    doc.moveTo(50, y + 5).lineTo(500, y + 5).strokeColor('#cbd5e1').stroke();
    y += 15;
    doc.fontSize(12).fillColor('#0f172a').text('Total Paid', 50, y);
    doc.text(`Rs. ${data.total.toFixed(2)}`, 400, y, { width: 100, align: 'right' });
    y += 30;

    doc.fontSize(9).fillColor('#64748b');
    doc.text(`Payment Method: ${data.method}`, 50, y);
    if (data.collectedBy) doc.text(`Collected By: ${data.collectedBy}`, 50, y + 14);

    doc.moveDown(3);
    doc.fontSize(8).fillColor('#94a3b8').text('This is a system-generated receipt and does not require a signature.', {
      align: 'center',
    });

    doc.end();

    return new Promise((resolve, reject) => {
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}
