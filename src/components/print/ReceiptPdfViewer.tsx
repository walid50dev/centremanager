import { PDFViewer } from '@react-pdf/renderer';
import ReceiptA4Document from './ReceiptA4';
import ReceiptThermalDocument from './ReceiptThermal';
import type { ReceiptDocumentData, ReceiptLabels } from './receiptLabels';
import type { ReceiptTemplate } from './receiptPdf';

export interface ReceiptPdfViewerProps {
  template: ReceiptTemplate;
  data: ReceiptDocumentData;
  labels: ReceiptLabels;
  /** Height of the inline viewer, in pixels. */
  height?: number;
}

/**
 * Inline PDF preview.
 *
 * Loaded through `React.lazy` by the modal: this module pulls the whole
 * `@react-pdf/renderer` chunk, which the rest of the app never needs.
 */
export function ReceiptPdfViewer({ template, data, labels, height = 400 }: ReceiptPdfViewerProps) {
  return (
    <PDFViewer
      width="100%"
      height={height}
      showToolbar={false}
      style={{ border: 0 }}
      data-testid="receipt-pdf-viewer"
    >
      {template === 'a4' || template === 'a5' ? (
        <ReceiptA4Document data={data} labels={labels} template={template} />
      ) : (
        <ReceiptThermalDocument data={data} labels={labels} template={template} />
      )}
    </PDFViewer>
  );
}

export default ReceiptPdfViewer;
