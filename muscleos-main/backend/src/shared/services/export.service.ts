import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

export interface ExportColumn {
  header: string;
  key: string;
  width?: number;
}

/**
 * Central export engine used by Reports, Payments, Members, Batches, etc.
 * Produces Buffers so controllers can stream them straight to the response
 * without touching the filesystem.
 */
@Injectable()
export class ExportService {
  async toExcel(
    rows: Record<string, any>[],
    columns: ExportColumn[],
    sheetName = 'Sheet1',
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MuscleOS';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 20,
    }));

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    rows.forEach((row) => sheet.addRow(row));

    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  async toCsv(rows: Record<string, any>[], columns: ExportColumn[]): Promise<Buffer> {
    const header = columns.map((c) => this.escapeCsv(c.header)).join(',');
    const lines = rows.map((row) =>
      columns.map((c) => this.escapeCsv(row[c.key])).join(','),
    );
    return Buffer.from([header, ...lines].join('\n'), 'utf-8');
  }

  private escapeCsv(value: any): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  async toPdf(options: {
    title: string;
    subtitle?: string;
    columns: ExportColumn[];
    rows: Record<string, any>[];
    summary?: { label: string; value: string | number }[];
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).fillColor('#1E293B').text('MuscleOS', { continued: false });
      doc.fontSize(14).fillColor('#334155').text(options.title);
      if (options.subtitle) {
        doc.fontSize(10).fillColor('#64748B').text(options.subtitle);
      }
      doc.moveDown(0.5);
      doc
        .fontSize(8)
        .fillColor('#94A3B8')
        .text(`Generated on ${new Date().toLocaleString()}`);
      doc.moveDown(1);

      if (options.summary?.length) {
        doc.fontSize(10).fillColor('#1E293B');
        options.summary.forEach((s) => {
          doc.text(`${s.label}: ${s.value}`, { continued: false });
        });
        doc.moveDown(1);
      }

      const startX = doc.page.margins.left;
      let y = doc.y;
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const colWidth = pageWidth / options.columns.length;

      const drawHeader = () => {
        doc.fontSize(9).fillColor('#FFFFFF');
        doc.rect(startX, y, pageWidth, 20).fill('#1E293B');
        doc.fillColor('#FFFFFF');
        options.columns.forEach((col, i) => {
          doc.text(col.header, startX + i * colWidth + 4, y + 6, {
            width: colWidth - 8,
          });
        });
        y += 20;
      };

      drawHeader();

      doc.fontSize(8);
      options.rows.forEach((row, idx) => {
        if (y > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
          y = doc.page.margins.top;
          drawHeader();
        }
        if (idx % 2 === 0) {
          doc.rect(startX, y, pageWidth, 18).fill('#F8FAFC');
        }
        doc.fillColor('#334155');
        options.columns.forEach((col, i) => {
          doc.text(String(row[col.key] ?? ''), startX + i * colWidth + 4, y + 5, {
            width: colWidth - 8,
          });
        });
        y += 18;
      });

      doc.end();
    });
  }
}
