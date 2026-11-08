import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, Printer, Receipt as ReceiptIcon } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { toast } from '../ui/Toast';
import { paymentsApi } from '../../services/payments';
import { settingsApi } from '../../services/settings';
import { cn, formatCurrency, stripIsolates } from '../../utils/format';
import { methodLabel, periodLabel } from '../../utils/billing';
import { pdfCompatibleLogo } from '../../utils/centreLogo';
import { buildReceiptDocument, buildReceiptLabels } from '../print/receiptLabels';
import {
  downloadReceiptPdf,
  normaliseTemplate,
  printReceiptPdf,
  type ReceiptPdfInput,
  type ReceiptTemplate,
} from '../print/receiptPdf';
import type { ReceiptData } from '../../types';

/** Pulled in only when a receipt is opened — the PDF engine lives in its own chunk. */
const ReceiptPdfViewer = lazy(() => import('../print/ReceiptPdfViewer'));

export interface ReceiptPreviewModalProps {
  receiptId: number;
  onClose: () => void;
}

const PDF_HEIGHT = 400;
const ARABIC_CHAR = /[\u0600-\u06FF]/;

function TemplateToggle({
  value,
  onChange,
}: {
  value: ReceiptTemplate;
  onChange: (template: ReceiptTemplate) => void;
}) {
  const { t } = useTranslation();
  const options: Array<{ value: ReceiptTemplate; label: string }> = [
    { value: 'thermal', label: t('receipt.thermal80') },
    { value: 'thermal58', label: t('receipt.thermal58') },
    { value: 'a5', label: 'A5 · 148 × 210 mm' },
    { value: 'a4', label: 'A4 · 210 × 297 mm' },
  ];

  return (
    <div
      className="inline-flex flex-wrap rounded-md border border-border bg-background p-0.5"
      role="tablist"
      aria-label="Format"
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={`receipt-template-${option.value}`}
            onClick={() => onChange(option.value)}
            className={cn(
              'btn-press rounded-[5px] px-3 py-1.5 text-[13px] font-medium transition-colors',
              selected
                ? 'bg-white text-primary shadow-sm'
                : 'text-muted hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Receipt preview — a real PDF this time (Phase 8).
 *
 * The document is rendered by `@react-pdf/renderer` from the **frozen** receipt
 * row, so an old receipt keeps the name, the groups and the total it was issued
 * with even after the student is renamed. The template defaults to the
 * `receipt_format` setting and can be switched for the current preview.
 */
export function ReceiptPreviewModal({ receiptId, onClose }: ReceiptPreviewModalProps) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [template, setTemplate] = useState<ReceiptTemplate>('thermal');
  const [busy, setBusy] = useState<'download' | 'print' | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    Promise.all([paymentsApi.receipt(receiptId), settingsApi.get('receipt_format').catch(() => null)])
      .then(async ([receipt, format]) => {
        const logo = receipt.center_logo ? await pdfCompatibleLogo(receipt.center_logo) : null;
        if (!active) return;
        setData({ ...receipt, center_logo: logo });
        // The setting wins for this preview; the toggle below only overrides it
        // until the modal is closed.
        setTemplate(normaliseTemplate(format));
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [receiptId]);

  // Built-in PDF fonts lack Arabic shaping; keep document labels in French.
  const pdfT = useMemo(() => i18n.getFixedT('fr'), [i18n]);
  const periodText = useMemo(() => {
    if (!data) return '';
    return data.periods.length > 0
      ? data.periods.map((period) => periodLabel(pdfT, period.month, period.year)).join(', ')
      : data.period_text;
  }, [data, pdfT]);

  const labels = useMemo(() => buildReceiptLabels(pdfT), [pdfT]);
  const document = useMemo(
    () => (data ? buildReceiptDocument(data, labels, periodText, methodLabel(pdfT, data.payment_method)) : null),
    [data, labels, periodText, pdfT],
  );

  // Arabic glyphs are outside the built-in Helvetica coverage: warn the user
  // instead of silently printing a page with missing words.
  const arabicWarning = useMemo(() => {
    if (!data) return false;
    const probe = [
      stripIsolates(data.center_name),
      stripIsolates(data.student_name),
      stripIsolates(data.groups_text),
      ...data.items.flatMap(item => [item.subject, item.group_name]),
      stripIsolates(periodText),
    ].join(' ');
    return ARABIC_CHAR.test(probe);
  }, [data, periodText]);

  const input: ReceiptPdfInput | null = document ? { template, data: document, labels } : null;

  const run = useCallback(
    async (kind: 'download' | 'print') => {
      if (!input) return;
      setBusy(kind);
      setPdfError(null);
      try {
        if (kind === 'download') {
          await downloadReceiptPdf(input);
          toast.success(t('receipt.downloaded'));
        } else {
          await printReceiptPdf(input);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setPdfError(message);
        toast.error(message);
      } finally {
        setBusy(null);
      }
    },
    [input, t],
  );

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>
        {t('receipt.close')}
      </Button>
      <Button
        variant="secondary"
        data-testid="receipt-print"
        loading={busy === 'print'}
        disabled={!input || busy !== null}
        leftIcon={<Printer className="h-4 w-4" aria-hidden="true" />}
        onClick={() => void run('print')}
      >
        {t('receipt.printPdf')}
      </Button>
      <Button
        data-testid="receipt-download"
        loading={busy === 'download'}
        disabled={!input || busy !== null}
        leftIcon={<Download className="h-4 w-4" aria-hidden="true" />}
        onClick={() => void run('download')}
      >
        {t('receipt.downloadPdf')}
      </Button>
    </>
  );

  return (
    <Modal open onClose={onClose} title={t('receipt.title')} size="lg" footer={footer}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TemplateToggle
            value={template}
            onChange={setTemplate}
          />
          <span className="text-[12px] text-muted" data-testid="receipt-summary">
            {data ? `${data.receipt_number} · ${formatCurrency(data.amount_cents)}` : t('receipt.loading')}
          </span>
        </div>

        {arabicWarning ? (
          <div
            className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-[12px] text-warning"
            data-testid="receipt-arabic-note"
          >
            {t('receipt.arabicLimitation')}
          </div>
        ) : null}

        {/* `receipt-print` keeps the sheet printable straight from the app too. */}
        <div
          className="receipt-print overflow-hidden rounded-md border border-border bg-white"
          data-testid="receipt-preview"
          data-template={template}
          style={{ height: PDF_HEIGHT }}
        >
          {loading ? (
            <div className="flex h-full flex-col gap-2 p-6" data-testid="receipt-loading">
              <div className="skeleton h-4 w-1/3 self-center" />
              <div className="skeleton h-3 w-1/2 self-center" />
              <div className="skeleton mt-4 h-3 w-2/3" />
              <div className="skeleton h-3 w-1/2" />
              <div className="skeleton mt-6 h-8 w-2/5 self-center" />
            </div>
          ) : loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
              <p className="text-[13px] text-foreground">{t('receipt.pdfError')}</p>
              <p className="text-[12px] text-muted">{loadError}</p>
            </div>
          ) : pdfError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
              <p className="text-[13px] text-foreground">{t('receipt.pdfError')}</p>
              <p className="text-[12px] text-muted">{pdfError}</p>
            </div>
          ) : input && data ? (
            <Suspense
              fallback={
                <div className="flex h-full flex-col gap-2 p-6" data-testid="receipt-loading">
                  <div className="skeleton h-4 w-1/3 self-center" />
                  <div className="skeleton h-3 w-1/2 self-center" />
                  <div className="skeleton mt-4 h-3 w-2/3" />
                  <div className="skeleton h-3 w-1/2" />
                  <div className="skeleton mt-6 h-8 w-2/5 self-center" />
                </div>
              }
            >
              <ReceiptPdfViewer
                template={template}
                data={document as NonNullable<typeof document>}
                labels={labels}
                height={PDF_HEIGHT}
              />
            </Suspense>
          ) : null}
        </div>

        <p className="flex items-center justify-center gap-1.5 text-[12px] text-muted">
          <ReceiptIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {data && data.periods.length === 0 ? t('receipt.advance') : periodText}
        </p>
      </div>
    </Modal>
  );
}

export default ReceiptPreviewModal;
