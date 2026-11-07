import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HandCoins } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import MoneyInput from '../ui/MoneyInput';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { toast } from '../ui/Toast';
import { teacherPaymentsApi } from '../../services/teachers';
import { todayIsoDate } from '../../utils/billing';

export interface SettlementModalProps {
  open: boolean;
  teacherId: number;
  teacherName: string;
  onClose: () => void;
  onSaved: () => void;
}

/** A manual payment, independent of any compensation configuration. */
export function SettlementModal({ open, teacherId, teacherName, onClose, onSaved }: SettlementModalProps) {
  const { t } = useTranslation();
  const formId = useId();
  const [amountCents, setAmountCents] = useState(0);
  const [date, setDate] = useState(todayIsoDate());
  const [method, setMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmountCents(0); setDate(todayIsoDate()); setMethod(''); setNotes(''); setShowErrors(false);
  }, [open, teacherId]);

  const submit = async () => {
    setShowErrors(true);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !date || !method || submitting) return;
    setSubmitting(true);
    try {
      await teacherPaymentsApi.create({ teacherId, amountCents, paymentDate: date, method, notes: notes.trim() || null });
      toast.success(t('teachers.settlement.toast'));
      onSaved(); onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally { setSubmitting(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="md"
      title={<span className="flex items-center gap-2"><HandCoins className="h-4 w-4 text-primary" aria-hidden="true" />{t('teachers.payment.record')}</span>}
      description={teacherName}
      footer={<><Button variant="secondary" onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
        <Button type="submit" form={formId} loading={submitting} disabled={submitting} data-testid="settlement-confirm">{t('common.save')}</Button></>}>
      <form id={formId} noValidate onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-4">
        <MoneyInput label={t('teachers.settlement.amount')} required valueCents={amountCents} onChange={setAmountCents}
          error={showErrors && amountCents <= 0 ? t('payment.validation.amountRequired') : undefined} autoFocus data-testid="settlement-amount" />
        <Input label={t('teachers.settlement.date')} type="date" required value={date} onChange={event => setDate(event.target.value)}
          error={showErrors && !date ? t('common.required') : undefined} data-testid="settlement-date" />
        <Select label={t('teachers.settlement.method')} required value={method} onChange={event => setMethod(event.target.value)}
          error={showErrors && !method ? t('common.required') : undefined} placeholder={t('teachers.payment.selectMethod')} data-testid="settlement-method"
          options={[{value:'espèces',label:t('payment.cash')},{value:'virement',label:t('payment.transfer')},{value:'chèque',label:t('payment.check')}]} />
        <Textarea label={t('teachers.settlement.notes')} rows={2} value={notes} onChange={event => setNotes(event.target.value)}
          placeholder={t('payment.notesPlaceholder')} data-testid="settlement-notes" />
      </form>
    </Modal>
  );
}
export default SettlementModal;
