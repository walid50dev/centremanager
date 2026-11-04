import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import Button from './Button';
import ConfirmDialog from './ConfirmDialog';
import { toast } from './Toast';
import { trashApi } from '../../services/trash';
import type { TrashEntityType } from '../../types';

export default function TrashButton({ type, id, name, onDeleted }: { type: TrashEntityType; id: number; name?: string; onDeleted: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const remove = async () => {
    setLoading(true);
    try { await trashApi.remove(type, id); setOpen(false); toast.success(t('trash.moved')); onDeleted(); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  };
  return <span onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Button variant="ghost" size="icon" aria-label={t('trash.delete')} title={t('trash.delete')} data-testid={`trash-${type}-${id}`} onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" /></Button>
    <ConfirmDialog open={open} title={t('trash.delete')} message={type === 'student' ? t('trash.confirm_student_delete', { name: name ?? '' }) : t('trash.confirm_delete')} confirmLabel={t('trash.delete')} cancelLabel={t('common.cancel')} loading={loading} onClose={() => setOpen(false)} onConfirm={() => void remove()} />
  </span>;
}
