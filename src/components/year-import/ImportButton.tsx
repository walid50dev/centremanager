import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { yearImportApi, type ImportKind, type ImportableItem } from '../../services/yearImport';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import { toast } from '../ui/Toast';

export default function ImportButton({ kind, onImported }: { kind: ImportKind; onImported: () => void }) {
  const { t } = useTranslation();
  const years = useAppStore(state => state.schoolYears);
  const active = useAppStore(state => state.activeSchoolYear);
  const previous = useMemo(() => {
    if (!active) return undefined;
    return years.filter(year => year.id !== active.id && year.start_date && active.start_date && year.start_date < active.start_date)
      .sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? '') || b.id - a.id)[0];
  }, [years, active]);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportableItem[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !previous) return;
    let live = true; setLoading(true); setSelected([]); setQuery('');
    yearImportApi.list(kind, previous.id).then(items => { if (live) setRows(items); })
      .catch(error => { if (live) { setRows([]); toast.error(error instanceof Error ? error.message : String(error)); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, previous?.id, kind]);
  if (!previous || !active) return null;
  const visible = rows.filter(row => `${row.label} ${row.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selectable = rows.filter(row => !row.already_imported).map(row => row.id);
  const submit = async () => {
    if (!selected.length || saving) return;
    setSaving(true);
    try {
      const count = await yearImportApi.import(kind, selected, active.id);
      setOpen(false); onImported(); toast.success(t('import.success', { n: count }));
    } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  return <>
    <Button variant="secondary" data-testid={`import-${kind}`} leftIcon={<Download className="h-4 w-4" />} onClick={() => setOpen(true)}>{t('import.button')}</Button>
    <Modal open={open} onClose={() => { if (!saving) setOpen(false); }} title={t(`import.title_${kind}`, { year: previous.label ?? '' })}
      footer={<><Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
        <Button data-testid="import-submit" disabled={!selected.length || loading} loading={saving} onClick={() => void submit()}>{t('import.import_n', { n: selected.length })}</Button></>}>
      <Input value={query} onChange={event => setQuery(event.target.value)} aria-label={t('common.search')} placeholder={t('common.search')} data-testid="import-search" />
      <div className="my-3 flex gap-2"><Button size="sm" variant="ghost" onClick={() => setSelected(current => [...new Set([...current, ...selectable])])}>{t('import.select_all')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected([])}>{t('import.deselect_all')}</Button></div>
      {loading ? <p>{t('common.loading')}</p> : !visible.length ? <p className="text-muted">{t('import.no_data')}</p> : <ul className="max-h-80 divide-y divide-border overflow-y-auto">
        {visible.map(row => <li key={row.id}><label className={`flex items-start gap-3 py-3 ${row.already_imported ? 'opacity-50' : ''}`}>
          <input type="checkbox" data-testid={`import-item-${row.id}`} disabled={row.already_imported || saving} checked={selected.includes(row.id)} onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} />
          <span><span className="block font-medium" dir="auto">{row.label}</span><span className="text-sm text-muted" dir="auto">{row.detail}</span>{row.already_imported && <span className="ms-2 text-xs">{t('import.already_imported')}</span>}</span>
        </label></li>)}
      </ul>}
    </Modal>
  </>;
}
