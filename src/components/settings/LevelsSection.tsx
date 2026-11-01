import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GraduationCap,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Input from '../ui/Input';
import ConfirmDialog from '../ui/ConfirmDialog';
import SettingsSection from './SettingsSection';
import { toast } from '../ui/Toast';
import { levelsApi } from '../../services/settings';
import { cn } from '../../utils/format';
import type { Branch, Level } from '../../types';

const CATEGORIES = ['primaire', 'college', 'lycee'] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABEL_KEYS: Record<Category, string> = {
  primaire: 'settings.levels.primaire',
  college: 'settings.levels.college',
  lycee: 'settings.levels.lycee',
};

interface PendingDelete {
  kind: 'level' | 'branch';
  id: number;
  label: string;
}

/** Section 3 — levels (grouped by category) and their branches. */
export function LevelsSection() {
  const { t } = useTranslation();

  const [levels, setLevels] = useState<Level[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftNames, setDraftNames] = useState<Record<number, string>>({});
  const [orderDirty, setOrderDirty] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [addCategory, setAddCategory] = useState<Category | null>(null);
  const [newLevelName, setNewLevelName] = useState('');
  const [branchDrafts, setBranchDrafts] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextLevels, nextBranches] = await Promise.all([
        levelsApi.list(),
        levelsApi.branches(),
      ]);
      setLevels(nextLevels);
      setBranches(nextBranches);
      setDraftNames({});
      setOrderDirty(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const byCategory = useGroupedLevels(levels);
  const branchesByLevel = useMemo(() => {
    const map = new Map<number, Branch[]>();
    for (const branch of branches) {
      if (branch.level_id === null) continue;
      const list = map.get(branch.level_id) ?? [];
      list.push(branch);
      map.set(branch.level_id, list);
    }
    return map;
  }, [branches]);

  // -- ordering ---------------------------------------------------------
  const move = (level: Level, direction: -1 | 1) => {
    const category = (level.category ?? 'primaire') as Category;
    const group = byCategory[category] ?? [];
    const index = group.findIndex((entry) => entry.id === level.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= group.length) return;

    const reordered = [...group];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    // Renumber every category so `sort_order` stays 1..n per category.
    const nextById = new Map<number, number>();
    let running = 1;
    CATEGORIES.forEach((currentCategory) => {
      const currentGroup =
        currentCategory === category ? reordered : (byCategory[currentCategory] ?? []);
      currentGroup.forEach((entry) => {
        nextById.set(entry.id, running);
        running += 1;
      });
    });

    setLevels((previous) =>
      previous.map((entry) => ({ ...entry, sort_order: nextById.get(entry.id) ?? entry.sort_order })),
    );
    setOrderDirty(true);
  };

  const saveOrder = async () => {
    setSavingOrder(true);
    try {
      const ordered = CATEGORIES.flatMap((category) => byCategory[category] ?? []);
      await Promise.all(
        ordered.map((level) =>
          levelsApi.update(level.id, draftNames[level.id] ?? level.name, level.sort_order ?? 0),
        ),
      );
      setOrderDirty(false);
      await load();
      toast.success(t('settings.levels.orderSaved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setSavingOrder(false);
    }
  };

  // -- level editing ----------------------------------------------------
  const commitName = async (level: Level) => {
    const draft = draftNames[level.id];
    if (draft === undefined) return;

    const trimmed = draft.trim();
    if (!trimmed) {
      setDraftNames((previous) => {
        const next = { ...previous };
        delete next[level.id];
        return next;
      });
      return;
    }
    if (trimmed === level.name) {
      setDraftNames((previous) => {
        const next = { ...previous };
        delete next[level.id];
        return next;
      });
      return;
    }

    try {
      await levelsApi.update(level.id, trimmed, level.sort_order ?? 0);
      setLevels((previous) =>
        previous.map((entry) => (entry.id === level.id ? { ...entry, name: trimmed } : entry)),
      );
      setDraftNames((previous) => {
        const next = { ...previous };
        delete next[level.id];
        return next;
      });
      toast.success(t('settings.levels.levelUpdated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    }
  };

  const addLevel = async (category: Category) => {
    const name = newLevelName.trim();
    if (!name) return;
    const group = byCategory[category] ?? [];
    const nextSort =
      group.reduce((max, entry) => Math.max(max, entry.sort_order ?? 0), 0) + 1;

    try {
      await levelsApi.create(name, category, nextSort);
      setNewLevelName('');
      setAddCategory(null);
      await load();
      toast.success(t('settings.levels.levelCreated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    }
  };

  // -- branches ---------------------------------------------------------
  const addBranch = async (levelId: number) => {
    const name = (branchDrafts[levelId] ?? '').trim();
    if (!name) return;
    try {
      await levelsApi.createBranch(name, levelId);
      setBranchDrafts((previous) => ({ ...previous, [levelId]: '' }));
      await load();
      toast.success(t('settings.levels.branchCreated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    }
  };

  // -- delete -----------------------------------------------------------
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.kind === 'level') {
        await levelsApi.remove(pendingDelete.id);
      } else {
        await levelsApi.removeBranch(pendingDelete.id);
      }
      setPendingDelete(null);
      await load();
      toast.success(
        pendingDelete.kind === 'level'
          ? t('settings.levels.levelDeleted')
          : t('settings.levels.branchDeleted'),
      );
    } catch (error) {
      // e.g. "Ce niveau est utilisé par 2 groupe(s)…"
      toast.error(error instanceof Error ? error.message : t('common.error'));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SettingsSection
      icon={<GraduationCap className="h-[18px] w-[18px]" aria-hidden="true" />}
      title={t('settings.section.levels')}
      description={t('settings.levels.description')}
    >
      {loading ? (
        <p className="text-[13px] text-muted">{t('common.loading')}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {CATEGORIES.map((category) => {
            const group = byCategory[category] ?? [];
            return (
              <div key={category}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
                    {t(CATEGORY_LABEL_KEYS[category])}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setAddCategory(addCategory === category ? null : category);
                      setNewLevelName('');
                    }}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('settings.levels.add')}
                  </button>
                </div>

                {addCategory === category && (
                  <div className="mb-2 flex gap-2 rounded-md border border-border bg-background p-2">
                    <Input
                      autoFocus
                      containerClassName="flex-1"
                      placeholder={t('settings.levels.addPlaceholder')}
                      value={newLevelName}
                      onChange={(event) => setNewLevelName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void addLevel(category);
                        if (event.key === 'Escape') setAddCategory(null);
                      }}
                    />
                    <Button size="sm" onClick={() => void addLevel(category)}>
                      {t('common.add')}
                    </Button>
                  </div>
                )}

                <ul className="divide-y divide-border rounded-md border border-border">
                  {group.length === 0 && (
                    <li className="px-3 py-4 text-center text-[13px] text-muted">
                      {t('settings.levels.empty')}
                    </li>
                  )}
                  {group.map((level, index) => {
                    const levelBranches = branchesByLevel.get(level.id) ?? [];
                    const isOpen = expanded[level.id] ?? false;
                    const isLycee = category === 'lycee';

                    return (
                      <li key={level.id} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {isLycee ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded((previous) => ({
                                  ...previous,
                                  [level.id]: !isOpen,
                                }))
                              }
                              aria-expanded={isOpen}
                              aria-label={t('settings.levels.branches')}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground"
                            >
                              <ChevronDown
                                className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
                                aria-hidden="true"
                              />
                            </button>
                          ) : (
                            <span className="h-7 w-7" aria-hidden="true" />
                          )}

                          <Input
                            containerClassName="flex-1"
                            className="h-8"
                            aria-label={t('settings.levels.levelName')}
                            value={draftNames[level.id] ?? level.name}
                            onChange={(event) =>
                              setDraftNames((previous) => ({
                                ...previous,
                                [level.id]: event.target.value,
                              }))
                            }
                            onBlur={() => void commitName(level)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                            }}
                          />

                          {isLycee && (
                            <Badge variant="muted" className="hidden sm:inline-flex">
                              {t('settings.levels.branchCount', { count: levelBranches.length })}
                            </Badge>
                          )}

                          <div className="flex items-center">
                            <button
                              type="button"
                              onClick={() => move(level, -1)}
                              disabled={index === 0}
                              aria-label={t('settings.levels.moveUp')}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground disabled:opacity-30"
                            >
                              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => move(level, 1)}
                              disabled={index === group.length - 1}
                              aria-label={t('settings.levels.moveDown')}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground disabled:opacity-30"
                            >
                              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setPendingDelete({
                                  kind: 'level',
                                  id: level.id,
                                  label: level.name,
                                })
                              }
                              aria-label={`${t('settings.levels.deleteLevel')} : ${level.name}`}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        {isLycee && isOpen && (
                          <div className="ms-9 mt-2 rounded-md bg-background p-3">
                            <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">
                              {t('settings.levels.branches')}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {levelBranches.length === 0 && (
                                <span className="text-[13px] text-muted">
                                  {t('settings.levels.noBranches')}
                                </span>
                              )}
                              {levelBranches.map((branch) => (
                                <span
                                  key={branch.id}
                                  className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] text-foreground ring-1 ring-border"
                                >
                                  {branch.name}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPendingDelete({
                                        kind: 'branch',
                                        id: branch.id,
                                        label: branch.name,
                                      })
                                    }
                                    aria-label={`${t('settings.levels.deleteBranch')} : ${branch.name}`}
                                    className="rounded-full p-0.5 text-muted transition-colors hover:bg-destructive/10 hover:text-destructive"
                                  >
                                    <X className="h-3 w-3" aria-hidden="true" />
                                  </button>
                                </span>
                              ))}
                            </div>

                            <div className="mt-2 flex gap-2">
                              <Input
                                containerClassName="max-w-xs flex-1"
                                className="h-8"
                                placeholder={t('settings.levels.branchPlaceholder')}
                                aria-label={`${t('settings.levels.addBranch')} : ${level.name}`}
                                value={branchDrafts[level.id] ?? ''}
                                onChange={(event) =>
                                  setBranchDrafts((previous) => ({
                                    ...previous,
                                    [level.id]: event.target.value,
                                  }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') void addBranch(level.id);
                                }}
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void addBranch(level.id)}
                                leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                              >
                                {t('settings.levels.addBranch')}
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <p className="text-[12px] text-muted">{t('settings.levels.orderHint')}</p>
            <Button
              onClick={saveOrder}
              loading={savingOrder}
              disabled={!orderDirty}
              leftIcon={<Save className="h-4 w-4" aria-hidden="true" />}
            >
              {t('settings.levels.saveOrder')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete?.kind === 'branch'
            ? t('settings.levels.deleteBranch')
            : t('settings.levels.deleteLevel')
        }
        message={t('settings.levels.deleteConfirm', { name: pendingDelete?.label ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </SettingsSection>
  );
}

/** Group levels by category, sorted by `sort_order`. */
function useGroupedLevels(levels: Level[]): Record<Category, Level[]> {
  return useMemo(() => {
    const grouped: Record<Category, Level[]> = { primaire: [], college: [], lycee: [] };
    for (const level of levels) {
      const category = (level.category ?? 'primaire') as Category;
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(level);
    }
    for (const category of CATEGORIES) {
      grouped[category].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name),
      );
    }
    return grouped;
  }, [levels]);
}

export default LevelsSection;
