import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Trash2 } from 'lucide-react';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/Toast';
import { trashApi, TRASH_CHANGED } from '../services/trash';
import { formatDateTime } from '../utils/format';
import type { TrashItem } from '../types';

export default function TrashPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<TrashItem | 'empty' | null>(null);
  const load = useCallback(async () => {
    try { setItems(await trashApi.list()); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const refresh = () => void load(); window.addEventListener(TRASH_CHANGED, refresh); return () => window.removeEventListener(TRASH_CHANGED, refresh); }, [load]);
  const restore = async (item: TrashItem) => {
    setBusy(true);
    try { await trashApi.restore(item.entity_type, item.entity_id); toast.success(t('trash.restored')); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm) return; setBusy(true);
    try { if (confirm === 'empty') await trashApi.empty(); else await trashApi.deletePermanently(confirm.entity_type, confirm.entity_id); setConfirm(null); toast.success(t('trash.purged')); }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3"><h1>{t('trash.title')}</h1><Button variant="destructive" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirm('empty')} disabled={!items.some(item => !item.has_financial_history) || busy}>{t('trash.empty_action')}</Button></div>
    <p className="text-sm text-muted">{t('trash.retention')}</p>
    <div className="card overflow-x-auto"><table className="w-full text-start text-body"><thead><tr>{['type','name','deleted_at','days_remaining','actions'].map(key => <th key={key} className="border-b border-border p-3 text-start text-muted">{t(`trash.${key}`)}</th>)}</tr></thead>
      <tbody>{loading ? <tr><td colSpan={5} className="p-4">{t('common.loading')}</td></tr> : items.length === 0 ? <tr><td colSpan={5} className="p-4">{t('trash.empty')}</td></tr> : items.map(item => <tr key={`${item.entity_type}-${item.entity_id}`} className="border-b border-border">
        <td className="p-3">{t(`trash.type_${item.entity_type}`)}</td><td className="p-3">{item.name}</td><td className="p-3">{formatDateTime(item.deleted_at)}</td>
        <td className="p-3">{item.permanent ? t('trash.preserved') : t('trash.days_count', { count: item.days_remaining })}{item.has_financial_history && !item.permanent ? <div className="text-xs text-muted">{t('trash.financial_warning')}</div> : null}</td>
        <td className="p-3"><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={busy} leftIcon={<RotateCcw className="h-4 w-4" />} onClick={() => void restore(item)}>{t('trash.restore')}</Button><Button size="sm" variant="ghost" disabled={busy || item.has_financial_history} title={item.has_financial_history ? t('trash.preserved') : undefined} onClick={() => setConfirm(item)}>{t('trash.delete_permanently')}</Button></div></td>
      </tr>)}</tbody></table></div>
    <ConfirmDialog open={confirm !== null} title={t(confirm === 'empty' ? 'trash.empty_action' : 'trash.delete_permanently')} message={t(confirm === 'empty' ? 'trash.confirm_empty' : 'trash.confirm_permanent')} confirmLabel={t(confirm === 'empty' ? 'trash.empty_action' : 'trash.delete_permanently')} cancelLabel={t('common.cancel')} loading={busy} onClose={() => setConfirm(null)} onConfirm={() => void remove()} />
  </div>;
}
