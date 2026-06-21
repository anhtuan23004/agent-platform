import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core';

export interface RenderedReportPdf {
  bytes: Buffer;
  sizeBytes: number;
  pageCount: number | undefined;
}

export interface PdfRenderOptions {
  executablePath?: string;
  maxArtifactBytes?: number;
}

const DEFAULT_MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

export async function renderReportPdf(
  html: string,
  options: PdfRenderOptions = {},
): Promise<RenderedReportPdf> {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  try {
    browser = await chromium.launch({
      executablePath:
        options.executablePath ??
        process.env.CHROMIUM_EXECUTABLE_PATH ??
        '/usr/bin/chromium-browser',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    context = await browser.newContext();
    await context.route('**/*', async (route) => route.abort('blockedbyclient'));
    page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const raw = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#64748b;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      margin: { top: '14mm', right: '12mm', bottom: '16mm', left: '12mm' },
      preferCSSPageSize: true,
    });
    const bytes = Buffer.from(raw);
    validatePdfArtifact(bytes, options.maxArtifactBytes);
    return {
      bytes,
      sizeBytes: bytes.byteLength,
      pageCount: countPdfPages(bytes),
    };
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

export function validatePdfArtifact(bytes: Uint8Array, maxArtifactBytes?: number): void {
  const limit = maxArtifactBytes ?? readMaxArtifactBytes();
  if (bytes.byteLength === 0) throw new Error('report_pdf_empty');
  if (bytes.byteLength > limit) throw new Error('report_pdf_artifact_too_large');
  if (Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
    throw new Error('report_pdf_invalid_magic');
  }
}

export function readMaxArtifactBytes(): number {
  const raw = process.env.PMO_REPORT_MAX_ARTIFACT_BYTES;
  if (!raw) return DEFAULT_MAX_ARTIFACT_BYTES;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('invalid_pmo_report_max_artifact_bytes');
  }
  return value;
}

function countPdfPages(bytes: Buffer): number | undefined {
  const matches = bytes.toString('latin1').match(/\/Type\s*\/Page\b/g);
  return matches?.length || undefined;
}
