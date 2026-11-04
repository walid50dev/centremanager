import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { toast } from '../ui/Toast';
import { levelsApi } from '../../services/settings';
import type { Branch, Level } from '../../types';
import EntityModalShell from './EntityModalShell';

/** A branch needs a name and a level; neither is copied from the parent. */
export default function BranchModal({ levels, zIndex = 60, onCreated, onClose }: {
  levels: Level[]; zIndex?: number; onCreated: (branch: Branch) => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [levelId, setLevelId] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !levelId || saving) return;
    setSaving(true);
    try {
      const id = await levelsApi.createBranch(name.trim(), Number(levelId));
      onCreated({ id, name: name.trim(), level_id: Number(levelId) });
      toast.success(t('settings.levels.branchCreated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally { setSaving(false); }
  };
  return <EntityModalShell open zIndex={zIndex} onClose={onClose} saving={saving}
    title={t('settings.levels.addBranch')} formId="branch-form" testId="branch-modal"
    canSubmit={Boolean(name.trim() && levelId)}>
    <form id="branch-form" onSubmit={event => void submit(event)} className="space-y-4">
      <Input autoFocus required label={t('settings.levels.addBranch')} placeholder={t('settings.levels.branchPlaceholder')}
        value={name} onChange={event => setName(event.target.value)} data-testid="branch-name" />
      <Select required label={t('students.level')} placeholder={t('students.selectLevel')}
        value={levelId} onChange={event => setLevelId(event.target.value)}
        options={levels.filter(level => level.category === 'lycee').map(level => ({ value: level.id, label: `${level.name} (${level.category})` }))}
        data-testid="branch-level" />
    </form>
  </EntityModalShell>;
}
