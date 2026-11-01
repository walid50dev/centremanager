import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HandCoins } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import MoneyInput from '../ui/MoneyInput';
import Textarea from '../ui/Textarea';
import { toast } from '../ui/Toast';
import { compensationApi } from '../../services/teachers';
import { periodLabel } from '../../utils/billing';
import { cn, formatCurrency } from '../../utils/format';

export interface SettlementModalProps {
  open: boolean;
  teacherId: number;
  teacherName: string;
  month: number;
  year: number;
  /** Remaining amount, used to pre-fill the field. */
  remainingCents: number;
  totalCents: number;
  onClose: () => void;
  onSaved: () => void;
}

const METHODS = [
  { value: 'espèces', labelKey: 'payment.cash' },
  { value: 'virement', labelKey: 'payment.transfer' },
  { value: 'chèque', labelKey: 'payment.check' },
] as const;

/** Pay a teacher for one month (several settlements per month are allowed). */
export function SettlementModal({
  open,
  teacherId,
  teacherName,
  month,
  year,
  remainingCents,
  totalCents,
  onClose,
  onSaved,
}: SettlementModalProps) {
  const { t } = useTranslation();

  const [amountCents, setAmountCents] = useState(Math.max(0, remainingCents));
  const [method, setMethod] = useState<string>('espèces');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmountCents(Math.max(0, remainingCents));
    setMethod('espèces');
    setNotes('');
    setSubmitting(false);
  }, [open, remainingCents, month, year, teacherId]);

  const overpaid = amountCents > remainingCents;
  const valid = amountCents > 0 && Boolean(method);

  const submit = async () => {
    if (!valid) {
      toast.error(t('payment.validation.amountRequired'));
      return;
    }
    setSubmitting(true);
    try {
      await compensationApi.recordSettlement({
        teacherId,
        month,
        year,
        amountCents,
        method,
        notes: notes.trim() ? notes.trim() : null,
      });
      toast.success(t('teachers.settlement.toast'));
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <HandCoins className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('teachers.comp.settle')}
        </span>
      }
      description={`${teacherName} · ${periodLabel(t, month, year)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={submitting} disabled={!valid} data-testid="settlement-confirm">
            {t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-md bg-background px-3 py-2 text-[13px]">
          <span className="text-muted">{t('teachers.comp.total')}</span>
          <span className="font-semibold tabular-nums">{formatCurrency(totalCents)}</span>
        </div>

        <MoneyInput
          label={t('teachers.settlement.amount')}
          valueCents={amountCents}
          onChange={setAmountCents}
          autoFocus
          data-testid="settlement-amount"
        />

        {overpaid ? (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-[13px] text-warning" role="status">
            {t('teachers.settlement.overpay', {
              amount: formatCurrency(amountCents - Math.max(0, remainingCents)),
            })}
          </p>
        ) : null}

        <div>
          <p className="mb-1.5 text-label text-muted">{t('teachers.settlement.method')}</p>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((entry) => (
              <label
                key={entry.value}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-[13px] transition-colors',
                  method === entry.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted hover:bg-background',
                )}
              >
                <input
                  type="radio"
                  name="settlement-method"
                  value={entry.value}
                  checked={method === entry.value}
                  onChange={() => setMethod(entry.value)}
                  className="sr-only"
                />
                {t(entry.labelKey)}
              </label>
            ))}
          </div>
        </div>

        <Textarea
          label={t('teachers.settlement.notes')}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={t('payment.notesPlaceholder')}
        />

        <p className="text-[12px] text-muted">{t('teachers.settlement.hint')}</p>
      </div>
    </Modal>
  );
}

export default SettlementModal;
