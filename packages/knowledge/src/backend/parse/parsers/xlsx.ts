import ExcelJS from 'exceljs';
import type { ParsedDocument, Parser } from './contract.ts';

export const xlsxParser: Parser = {
  async parse(buffer: Buffer): Promise<ParsedDocument> {
    const wb = new ExcelJS.Workbook();
    // ExcelJS Buffer type predates Node's generic Buffer<ArrayBufferLike>
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

    const sections: ParsedDocument['sections'] = [];
    wb.eachSheet((sheet) => {
      const rows: string[] = [];
      sheet.eachRow((row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          const v = cell.text ?? '';
          // Quote cells containing commas, quotes or newlines
          cells.push(/[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
        });
        rows.push(cells.join(','));
      });
      const text = rows.join('\n').trim();
      if (text.length > 0) {
        sections.push({ text, page_hint: sheet.name });
      }
    });

    return { sections };
  },
};
