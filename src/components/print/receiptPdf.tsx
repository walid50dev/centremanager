import type { ReceiptDocumentData, ReceiptLabels } from './receiptLabels';

/**
 * PDF plumbing for the receipt (Phase 8).
 *
 * `@react-pdf/renderer` is heavy (~1.4 MB of JS) and only useful the moment a
 * receipt is opened, so every entry point here uses a **dynamic import**: the
 * library lands in its own Vite chunk and the app shell stays small.
 */
export type ReceiptTemplate = 'a4' | 'thermal';

export const RECEIPT_TEMPLATES: ReceiptTemplate[] = ['a4', 'thermal'];

export interface ReceiptPdfInput {
  template: ReceiptTemplate;
  data: ReceiptDocumentData;
  labels: ReceiptLabels;
}

/** `a4` unless the settings say otherwise (or something unexpected arrives). */
export function normaliseTemplate(value: string | null | undefined): ReceiptTemplate {
  return value === 'thermal' ? 'thermal' : 'a4';
}

async function renderDocument({ template, data, labels }: ReceiptPdfInput) {
  const [{ pdf }, templateModule] = await Promise.all([
    import('@react-pdf/renderer'),
    template === 'a4' ? import('./ReceiptA4') : import('./ReceiptThermal'),
  ]);
  const Document = templateModule.default;
  return pdf(<Document data={data} labels={labels} />);
}

/** Render the selected template and return the PDF bytes. */
export async function buildReceiptPdf(input: ReceiptPdfInput): Promise<Blob> {
  const instance = await renderDocument(input);
  return instance.toBlob();
}

/** `recu_REC-20261031-0001.pdf`, sanitised for Windows. */
export function receiptFileName(receiptNumber: string): string {
  const safe = (receiptNumber || 'recu').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `recu_${safe}.pdf`;
}

/** Generate the PDF and hand it to the browser as a download. */
export async function downloadReceiptPdf(input: ReceiptPdfInput): Promise<void> {
  const blob = await buildReceiptPdf(input);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = receiptFileName(input.data.receiptNumber);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the download a moment to start before the blob disappears.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Open the PDF in its own window and send it straight to the printer.
 *
 * A popup blocker (or the Tauri webview) can refuse the new window; in that case
 * a hidden iframe takes over, which is enough for every engine that can render
 * PDFs at all.
 */
export async function printReceiptPdf(input: ReceiptPdfInput): Promise<void> {
  const blob = await buildReceiptPdf(input);
  const url = URL.createObjectURL(blob);

  // No `noopener` here: we need the handle back to trigger the print.
  const opened = window.open(url, '_blank');
  if (opened) {
    const trigger = () => {
      try {
        opened.focus();
        opened.print();
      } catch {
        /* the user can still print from the viewer toolbar */
      }
    };
    opened.addEventListener('load', trigger, { once: true });
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      /* nothing else we can do without a native print bridge */
    }
  };
  document.body.appendChild(frame);
  window.setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}
