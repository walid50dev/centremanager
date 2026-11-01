import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Check, Pencil, Plus, X } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SettingsSection from './SettingsSection';
import Switch from '../ui/Switch';
import { toast } from '../ui/Toast';
import { subjectsApi } from '../../services/settings';
import type { Subject } from '../../types';

/** Section 4 — subjects list with inline rename and active toggle. */
export function SubjectsSection() {
  const { t } = useTranslation();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setSubjects(await subjectsApi.list());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (subject: Subject) => {
    setBusyId(subject.id);
    try {
      await subjectsApi.update(subject.id, subject.name, !subject.is_active);
      setSubjects((previous) =>
        previous.map((entry) =>
          entry.id === subject.id ? { ...entry, is_active: !entry.is_active } : entry,
        ),
      );
      toast.success(t('settings.subjects.updated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setBusyId(null);
    }
  };

  const startEditing = (subject: Subject) => {
    setEditingId(subject.id);
    setEditingName(subject.name);
  };

  const commitRename = async (subject: Subject) => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === subject.name) {
      setEditingId(null);
      return;
    }
    try {
      await subjectsApi.update(subject.id, trimmed, subject.is_active);
      setSubjects((previous) =>
        previous.map((entry) => (entry.id === subject.id ? { ...entry, name: trimmed } : entry)),
      );
      setEditingId(null);
      toast.success(t('settings.subjects.updated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    }
  };

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await subjectsApi.create(trimmed);
      setNewName('');
      await load();
      toast.success(t('settings.subjects.created'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <SettingsSection
      icon={<BookOpen className="h-[18px] w-[18px]" aria-hidden="true" />}
      title={t('settings.section.subjects')}
      description={t('settings.subjects.description')}
    >
      {loading ? (
        <p className="text-[13px] text-muted">{t('common.loading')}</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full border-collapse text-body">
              <thead className="bg-background">
                <tr>
                  <th className="border-b border-border px-4 py-2.5 text-start text-label font-medium text-muted">
                    {t('settings.subjects.name')}
                  </th>
                  <th className="border-b border-border px-4 py-2.5 text-center text-label font-medium text-muted">
                    {t('settings.subjects.active')}
                  </th>
                  <th className="border-b border-border px-4 py-2.5 text-end text-label font-medium text-muted">
                    {t('settings.subjects.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {subjects.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-[13px] text-muted">
                      {t('settings.subjects.empty')}
                    </td>
                  </tr>
                )}
                {subjects.map((subject) => (
                  <tr key={subject.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2">
                      {editingId === subject.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            containerClassName="max-w-xs"
                            className="h-8"
                            aria-label={t('settings.subjects.rename')}
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void commitRename(subject);
                              if (event.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => void commitRename(subject)}
                            aria-label={t('common.save')}
                            className="rounded-md p-1.5 text-success transition-colors hover:bg-success/10"
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            aria-label={t('common.cancel')}
                            className="rounded-md p-1.5 text-muted transition-colors hover:bg-background"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="text-foreground">{subject.name}</span>
                          {!subject.is_active && (
                            <Badge variant="muted">{t('status.inactif')}</Badge>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <Switch
                        checked={subject.is_active}
                        disabled={busyId === subject.id}
                        label={`${t('settings.subjects.active')} : ${subject.name}`}
                        onChange={() => void handleToggle(subject)}
                      />
                    </td>
                    <td className="px-4 py-2 text-end">
                      <button
                        type="button"
                        onClick={() => startEditing(subject)}
                        aria-label={`${t('settings.subjects.rename')} : ${subject.name}`}
                        className="rounded-md p-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Input
              containerClassName="max-w-xs flex-1"
              label={t('settings.subjects.add')}
              placeholder={t('settings.subjects.addPlaceholder')}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleAdd();
              }}
            />
            <Button
              onClick={handleAdd}
              loading={adding}
              leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              {t('common.add')}
            </Button>
          </div>
        </>
      )}
    </SettingsSection>
  );
}

export default SubjectsSection;
