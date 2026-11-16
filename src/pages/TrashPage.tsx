import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, Trash2 } from 'lucide-react';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { toast } from '../components/ui/Toast';
import { trashApi, TRASH_CHANGED } from '../services/trash';
import { formatDateTime } from '../utils/format';
import type { TrashItem } from '../types';

function displayName(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : '—';
}

export default function TrashPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<TrashItem | 'empty' | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await trashApi.list());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener(TRASH_CHANGED, refresh);
    return () => window.removeEventListener(TRASH_CHANGED, refresh);
  }, [load]);

  const restore = async (item: TrashItem) => {
    setBusy(true);
    try {
      await trashApi.restore(item.entity_type, item.entity_id);
      toast.success(t('trash.restored'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === 'empty') await trashApi.empty();
      else await trashApi.deletePermanently(confirm.entity_type, confirm.entity_id);
      setConfirm(null);
      toast.success(t('trash.purged'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmName = confirm && confirm !== 'empty' ? displayName(confirm.name) : '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1>{t('trash.title')}</h1>
          <p className="mt-0.5 text-sm text-muted">{t('trash.retention')}</p>
        </div>
        <Button
          variant="destructive"
          leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          onClick={() => setConfirm('empty')}
          disabled={items.length === 0 || busy}
        >
          {t('trash.empty_action')}
        </Button>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="skeleton h-10 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Trash2 className="h-5 w-5" aria-hidden="true" />}
            title={t('trash.empty')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-start text-body">
              <thead className="bg-slate-50/80">
                <tr>
                  {['type', 'name', 'deleted_at', 'days_remaining', 'actions'].map((key) => (
                    <th key={key} className="border-b border-border px-4 py-2.5 text-start text-label font-medium text-muted">
                      {t(`trash.${key}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={`${item.entity_type}-${item.entity_id}`}
                    className="border-b border-border last:border-b-0 transition-colors hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 text-muted">{t(`trash.type_${item.entity_type}`)}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground" dir="auto">
                        {displayName(item.name)}
                      </span>
                      {item.guardian_phone ? (
                        <div className="text-xs text-muted" dir="ltr">
                          {item.guardian_phone}
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">
                      {formatDateTime(item.deleted_at) || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {item.permanent
                        ? t('trash.preserved')
                        : t('trash.days_count', { count: item.days_remaining })}
                      {item.has_financial_history && !item.permanent && item.entity_type !== 'student' ? (
                        <div className="mt-0.5 text-xs text-muted">{t('trash.financial_warning')}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
                          onClick={() => void restore(item)}
                        >
                          {t('trash.restore')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                          onClick={() => setConfirm(item)}
                        >
                          {t('trash.delete_permanently')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={t(confirm === 'empty' ? 'trash.empty_action' : 'trash.delete_permanently')}
        message={t(
          confirm === 'empty'
            ? 'trash.empty_confirm'
            : confirm?.entity_type === 'teacher'
              ? 'trash.teacher_confirm_permanent'
              : confirm?.entity_type === 'student'
                ? 'trash.confirm_student_purge'
                : 'trash.confirm_permanent',
          { name: confirmName },
        )}
        confirmLabel={t(confirm === 'empty' ? 'trash.empty_action' : 'trash.delete_permanently')}
        cancelLabel={t('common.cancel')}
        loading={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
