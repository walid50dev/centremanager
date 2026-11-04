import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Printer } from 'lucide-react';
import Button from '../ui/Button';
import CreatableEntitySelect from '../ui/CreatableEntitySelect';
import EmptyState from '../ui/EmptyState';
import Modal from '../ui/Modal';
import MoneyInput from '../ui/MoneyInput';
import { toast } from '../ui/Toast';
import { LATE_PAYMENTS_EVENT } from '../../stores/appStore';
import ReceiptPreviewModal from './ReceiptPreviewModal';
import StudentModal from '../students/StudentModal';
import { invoicesApi } from '../../services/invoices';
import { paymentsApi } from '../../services/payments';
import { studentsApi } from '../../services/students';
import { useDebounce } from '../../hooks/useDebounce';
import { cn, formatCurrency, formatPhone } from '../../utils/format';
import { methodLabel, periodLabel } from '../../utils/billing';
import type { PaymentMethod, Student, StudentInvoice } from '../../types';
import { PAYMENT_METHODS } from '../../types';

export interface PaymentModalProps {
  open: boolean;
  /** Pre-fills the student (opened from an alert row or the student sheet). */
  studentId?: number | null;
  onClose: () => void;
  /** Called after a payment is recorded, so the caller can refresh. */
  onSaved: () => void;
}

const STEPS = ['payment.step1', 'payment.step2', 'payment.step3', 'payment.step4'] as const;

const METHOD_ICONS: Record<PaymentMethod, string> = {
  espèces: '💵',
  virement: '🏦',
  chèque: '📝',
  autre: '📱',
};

/**
 * Four-step payment flow: student → invoices → amount/method → confirmation.
 *
 * The allocation itself is done by the backend (oldest invoice first), so this
 * component only decides *what* is being paid.
 */
export function PaymentModal({ open, studentId = null, onClose, onSaved }: PaymentModalProps) {
  const { t } = useTranslation();

  const [step, setStep] = useState(1);
  const [student, setStudent] = useState<Student | null>(null);
  const [invoices, setInvoices] = useState<StudentInvoice[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [amountCents, setAmountCents] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('espèces');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Student search (step 1, only when no student was pre-filled).
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [results, setResults] = useState<Student[]>([]);
  const [searching, setSearching] = useState(false);

  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [quickStudent, setQuickStudent] = useState(false);

  const unpaid = useMemo(() => invoices.filter((invoice) => invoice.remaining_cents > 0), [invoices]);
  const selectedInvoices = useMemo(
    () => unpaid.filter((invoice) => selected.includes(invoice.id)),
    [unpaid, selected],
  );
  const selectedTotal = useMemo(
    () => selectedInvoices.reduce((total, invoice) => total + invoice.remaining_cents, 0),
    [selectedInvoices],
  );

  /** Load the student + their unpaid invoices, then jump to step 2. */
  const loadStudent = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const [detail, studentInvoices] = await Promise.all([
        studentsApi.detail(id),
        invoicesApi.forStudent(id),
      ]);
      setStudent(detail.student);
      setInvoices(studentInvoices);
      const unpaidIds = studentInvoices
        .filter((invoice) => invoice.remaining_cents > 0)
        .map((invoice) => invoice.id);
      setSelected(unpaidIds);
      setAmountCents(
        studentInvoices
          .filter((invoice) => invoice.remaining_cents > 0)
          .reduce((total, invoice) => total + invoice.remaining_cents, 0),
      );
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Reset on open, and pre-load a fixed student.
  useEffect(() => {
    if (!open) { setQuickStudent(false); return; }
    setStep(studentId ? 2 : 1);
    setStudent(null);
    setInvoices([]);
    setSelected([]);
    setAmountCents(0);
    setMethod('espèces');
    setNotes('');
    setSearch('');
    setResults([]);
    setError(null);
    setReceiptId(null);
    if (studentId) void loadStudent(studentId);
  }, [open, studentId, loadStudent]);

  // Debounced student search.
  useEffect(() => {
    if (!open || step !== 1) return;
    let active = true;
    setSearching(true);
    studentsApi
      .list({ search: debouncedSearch, status: 'actif', limit: 8 })
      .then((page) => {
        if (active) setResults(page.data);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setSearching(false);
      });
    return () => {
      active = false;
    };
  }, [open, step, debouncedSearch]);

  const toggleInvoice = (invoice: StudentInvoice) => {
    setSelected((current) => {
      const next = current.includes(invoice.id)
        ? current.filter((id) => id !== invoice.id)
        : [...current, invoice.id];
      // Keep the amount in sync with the selection while on step 2.
      const total = unpaid
        .filter((entry) => next.includes(entry.id))
        .reduce((sum, entry) => sum + entry.remaining_cents, 0);
      setAmountCents(total);
      return next;
    });
  };

  const goToAmount = () => {
    if (selected.length === 0) {
      setError(t('payment.validation.invoicesRequired'));
      return;
    }
    setError(null);
    setAmountCents(selectedTotal);
    setStep(3);
  };

  const record = async (print: boolean) => {
    if (!student) return;
    if (amountCents <= 0) {
      setError(t('payment.validation.amountRequired'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const paymentId = await paymentsApi.record({
        studentId: student.id,
        invoiceIds: selected,
        amountCents,
        method,
        notes: notes.trim() ? notes.trim() : null,
      });
      toast.success(t('payment.toast.recorded'));
      // The sidebar badge counts late invoices: a payment can settle one.
      window.dispatchEvent(new CustomEvent(LATE_PAYMENTS_EVENT));
      onSaved();

      if (print) {
        try {
          const id = await paymentsApi.createReceipt(paymentId);
          setReceiptId(id);
        } catch (err) {
          toast.error(
            `${t('payment.toast.receiptError')} — ${err instanceof Error ? err.message : String(err)}`,
          );
          onClose();
        }
      } else {
        onClose();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`${t('payment.toast.error')} — ${message}`);
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <>
      {step > 1 && step < 4 ? (
        <Button variant="secondary" onClick={() => setStep(step - 1)} disabled={saving}>
          {t('payment.previous')}
        </Button>
      ) : null}
      {step === 1 ? (
        <Button variant="secondary" onClick={onClose}>
          {t('payment.cancel')}
        </Button>
      ) : null}
      {step === 2 ? (
        <Button
          data-testid="payment-next"
          onClick={goToAmount}
          disabled={selected.length === 0 || loading}
        >
          {t('payment.next')}
        </Button>
      ) : null}
      {step === 3 ? (
        <Button
          data-testid="payment-next"
          onClick={() => {
            if (amountCents <= 0) {
              setError(t('payment.validation.amountRequired'));
              return;
            }
            setError(null);
            setStep(4);
          }}
        >
          {t('payment.next')}
        </Button>
      ) : null}
      {step === 4 ? (
        <>
          <Button
            data-testid="payment-confirm"
            variant="secondary"
            onClick={() => void record(false)}
            loading={saving}
          >
            {t('payment.confirm')}
          </Button>
          <Button
            data-testid="payment-confirm-print"
            leftIcon={<Printer className="h-4 w-4" aria-hidden="true" />}
            onClick={() => void record(true)}
            loading={saving}
          >
            {t('payment.confirmAndPrint')}
          </Button>
        </>
      ) : null}
    </>
  );

  return (
    <>
      <Modal
        open={open && receiptId === null}
        onClose={onClose}
        title={t('payment.title')}
        description={t('payment.description')}
        size="lg"
        footer={footer}
      >
        {/* Step indicator */}
        <ol className="mb-4 flex items-center gap-2 text-[13px]" aria-label={t('payment.title')}>
          {STEPS.map((labelKey, index) => {
            const number = index + 1;
            const done = number < step;
            const active = number === step;
            return (
              <li key={labelKey} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                    active && 'bg-primary text-white',
                    done && 'bg-primary/15 text-primary',
                    !active && !done && 'bg-slate-100 text-muted',
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : number}
                </span>
                <span className={cn('font-medium', active ? 'text-foreground' : 'text-muted')}>
                  {t(labelKey)}
                </span>
                {number < STEPS.length ? (
                  <span className="hidden h-px flex-1 bg-border sm:block" aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>

        {error ? (
          <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {/* ---------------------------------------------------------- step 1 */}
        {step === 1 ? (
          <div className="space-y-3">
            <p className="text-[13px] font-medium text-foreground">{t('payment.selectStudent')}</p>

            {/* The list is searched by the backend (debounced) and the popup
                filters what came back — plus “+ Nouveau…” for a first payment
                taken before the student exists in the app. */}
            <CreatableEntitySelect
              testId="payment-student"
              placeholder={t('payment.searchPlaceholder')}
              options={results}
              value={null}
              onChange={(row) => {
                if (row) void loadStudent(row.id);
              }}
              getOptionLabel={(row) => row.full_name}
              getOptionValue={(row) => row.id}
              renderOption={(row) => `${row.level_name ?? '—'} · ${formatPhone(row.phone)}`}
              searchable
              searchPlaceholder={t('payment.searchPlaceholder')}
              onSearch={setSearch}
              onCreate={() => setQuickStudent(true)}
              emptyLabel={searching ? '…' : t('payment.selectStudent')}
            />
          </div>
        ) : null}

        {/* ---------------------------------------------------------- step 2 */}
        {step === 2 && student ? (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-background px-3 py-2 text-[13px]">
              <span className="text-muted">{t('payment.studentLabel')} </span>
              <span className="font-medium text-foreground">{student.full_name}</span>
              {/* The separator lives *inside* the LTR run: `ms-2` on a
                  `dir="ltr"` span resolves to its own left edge, so in RTL the
                  phone ended up glued to the name. */}
              <span className="text-muted" dir="ltr">{` — ${formatPhone(student.phone)}`}</span>
            </div>

            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, index) => (
                  <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
                ))}
              </div>
            ) : unpaid.length === 0 ? (
              <EmptyState
                icon={<Check className="h-5 w-5" aria-hidden="true" />}
                title={t('payment.noUnpaid')}
                description={t('payment.noUnpaidHint')}
              />
            ) : (
              <>
                <p className="text-[13px] font-medium text-foreground">{t('payment.selectInvoices')}</p>
                <ul className="divide-y divide-border rounded-md border border-border" data-testid="payment-invoices">
                  {unpaid.map((invoice) => {
                    const checked = selected.includes(invoice.id);
                    return (
                      <li key={invoice.id}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-3 px-3 py-2.5',
                            checked ? 'bg-primary/5' : 'hover:bg-background',
                          )}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={checked}
                            onChange={() => toggleInvoice(invoice)}
                            aria-label={`${periodLabel(t, invoice.period_month, invoice.period_year)} — ${invoice.group_subject}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-foreground">
                              {periodLabel(t, invoice.period_month, invoice.period_year)}
                            </span>
                            <span className="mt-0.5 block text-[12px] text-muted">
                              {invoice.group_subject} — {invoice.group_level}
                            </span>
                          </span>
                          <span className="shrink-0 text-end text-[12px] text-muted">
                            <span className="block">
                              {t('payment.invoiceAmount')}: {formatCurrency(invoice.amount_cents)}
                            </span>
                            <span className="block">
                              {t('payment.paid')}: {formatCurrency(invoice.paid_amount_cents)}
                            </span>
                          </span>
                          <span className="w-28 shrink-0 text-end text-[13px] font-semibold text-foreground">
                            {formatCurrency(invoice.remaining_cents)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex items-center justify-between rounded-md bg-primary/5 px-3 py-2 text-[13px]">
                  <span className="font-medium text-foreground">{t('payment.totalSelected')}</span>
                  <span className="font-semibold text-primary" data-testid="payment-selected-total">
                    {formatCurrency(selectedTotal)}
                  </span>
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* ---------------------------------------------------------- step 3 */}
        {step === 3 ? (
          <div className="space-y-4">
            <MoneyInput
              label={t('payment.amount')}
              valueCents={amountCents}
              onChange={setAmountCents}
              autoFocus
              data-testid="payment-amount"
            />

            {amountCents > 0 && amountCents < selectedTotal ? (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-[13px] text-warning" role="status">
                {t('payment.partial')}
                <span className="mt-1 block text-[12px]">
                  {t('payment.partialHint', { amount: formatCurrency(selectedTotal - amountCents) })}
                </span>
              </p>
            ) : null}
            {amountCents > selectedTotal ? (
              <p className="rounded-md bg-primary/10 px-3 py-2 text-[13px] text-primary" role="status">
                {t('payment.advance')}
                <span className="mt-1 block text-[12px]">
                  {t('payment.advanceHint', { amount: formatCurrency(amountCents - selectedTotal) })}
                </span>
              </p>
            ) : null}

            <fieldset>
              <legend className="mb-1.5 block text-label text-muted">{t('payment.method')}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PAYMENT_METHODS.map((value) => (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-[13px]',
                      method === value
                        ? 'border-primary bg-primary/5 font-medium text-primary'
                        : 'border-border text-foreground hover:bg-background',
                    )}
                  >
                    <input
                      type="radio"
                      name="payment-method"
                      className="sr-only"
                      value={value}
                      checked={method === value}
                      onChange={() => setMethod(value)}
                    />
                    <span aria-hidden="true">{METHOD_ICONS[value]}</span>
                    {methodLabel(t, value)}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor="payment-notes" className="mb-1.5 block text-label text-muted">
                {t('payment.notes')}
              </label>
              <textarea
                id="payment-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t('payment.notesPlaceholder')}
                rows={2}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-body text-foreground placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------------- step 4 */}
        {step === 4 && student ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-4 text-[13px]">
              <p className="text-muted">{t('payment.studentLabel')}</p>
              <p className="mb-3 font-medium text-foreground">{student.full_name}</p>

              <p className="text-muted">{t('payment.invoicesLabel')}</p>
              <ul className="mb-3 space-y-1">
                {selectedInvoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between gap-3">
                    <span>
                      {periodLabel(t, invoice.period_month, invoice.period_year)} — {invoice.group_subject}
                    </span>
                    <span className="text-muted">{formatCurrency(invoice.remaining_cents)}</span>
                  </li>
                ))}
              </ul>

              <p className="text-muted">{t('payment.amountLabel')}</p>
              <p className="text-h2 font-semibold text-foreground">{formatCurrency(amountCents)}</p>

              <p className="mt-3 text-muted">{t('payment.methodLabel')}</p>
              <p className="font-medium text-foreground">{methodLabel(t, method)}</p>

              {notes.trim() ? (
                <>
                  <p className="mt-3 text-muted">{t('payment.notesLabel')}</p>
                  <p className="whitespace-pre-line text-foreground">{notes.trim()}</p>
                </>
              ) : null}

              {amountCents > selectedTotal ? (
                <p className="mt-3 rounded-md bg-primary/10 px-3 py-2 text-[12px] text-primary">
                  {t('payment.advanceHint', { amount: formatCurrency(amountCents - selectedTotal) })}
                </p>
              ) : null}
              {amountCents < selectedTotal ? (
                <p className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-[12px] text-warning">
                  {t('payment.partialHint', { amount: formatCurrency(selectedTotal - amountCents) })}
                </p>
              ) : null}
            </div>
            <p className="text-[12px] text-muted">{t('payment.confirmation')}</p>
          </div>
        ) : null}
      </Modal>

      {quickStudent && open ? (
        <StudentModal
          open
          zIndex={60}
          onSaved={() => {}}
          onClose={() => setQuickStudent(false)}
          onCreated={(created) => {
            setQuickStudent(false);
            setSearch(created.full_name);
            void loadStudent(created.id);
          }}
        />
      ) : null}

      {receiptId !== null ? (
        <ReceiptPreviewModal
          receiptId={receiptId}
          onClose={() => {
            setReceiptId(null);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}

export default PaymentModal;
