import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { DatabaseBackup, Download, HardDriveDownload, RotateCcw } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import ConfirmDialog from '../ui/ConfirmDialog';
import SettingsSection from './SettingsSection';
import { toast } from '../ui/Toast';
import { backupApi, settingsApi } from '../../services/settings';
import { isTauri } from '../../services/api';
import { LATE_PAYMENTS_EVENT } from '../../stores/appStore';
import { formatBytes, formatDateTime, formatFileStamp } from '../../utils/format';
import type { DbInfo } from '../../types';

type RestoreStage = 'idle' | 'confirm' | 'info';

/** Section 8 — database backup and (manual) restore. */
export function BackupSection() {
  const { t } = useTranslation();

  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [backingUp, setBackingUp] = useState(false);
  const [restoreStage, setRestoreStage] = useState<RestoreStage>('idle');
  const [restoreFile, setRestoreFile] = useState<string>('');

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await backupApi.info());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const handleBackup = async () => {
    const defaultName = `centremanager_backup_${formatFileStamp()}.db`;
    let destination: string | null = null;

    try {
      if (isTauri()) {
        destination = await saveDialog({
          title: t('settings.backup.backupNow'),
          defaultPath: defaultName,
          filters: [{ name: 'SQLite', extensions: ['db'] }],
        });
      } else {
        // Browser preview: no native dialog available.
        destination = `/tmp/${defaultName}`;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
      return;
    }

    if (!destination) return; // dialog cancelled

    setBackingUp(true);
    try {
      await backupApi.backup(destination);
      await settingsApi.set('last_backup_date', new Date().toISOString());
      await loadInfo();
      toast.success(t('settings.backup.backupSuccess'));
    } catch (error) {
      toast.error(
        `${t('settings.backup.backupFailed')} ${error instanceof Error ? error.message : ''}`.trim(),
      );
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestore = async () => {
    try {
      if (isTauri()) {
        const selected = await openDialog({
          title: t('settings.backup.restore'),
          multiple: false,
          directory: false,
          filters: [{ name: 'SQLite', extensions: ['db'] }],
        });
        if (!selected || typeof selected !== 'string') return;
        setRestoreFile(selected);
      } else {
        setRestoreFile('centremanager_backup_20261031.db');
      }
      setRestoreStage('confirm');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    }
  };

  return (
    <SettingsSection
      icon={<DatabaseBackup className="h-[18px] w-[18px]" aria-hidden="true" />}
      title={t('settings.section.backup')}
      description={t('settings.backup.description')}
    >
      {loading ? (
        <p className="text-[13px] text-muted">{t('common.loading')}</p>
      ) : (
        <>
          <dl className="grid gap-3 rounded-md border border-border bg-background p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-label text-muted">{t('settings.backup.dbPath')}</dt>
              <dd className="mt-0.5 break-all font-mono text-[12px] text-foreground">
                {info?.path ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-label text-muted">{t('settings.backup.dbSize')}</dt>
              <dd className="mt-0.5 text-body text-foreground">
                {formatBytes(info?.size_bytes ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-label text-muted">{t('settings.backup.lastBackup')}</dt>
              <dd className="mt-0.5 text-body text-foreground">
                {info?.last_backup ? formatDateTime(info.last_backup) : t('settings.backup.never')}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => void handleBackup()}
              loading={backingUp}
              leftIcon={<Download className="h-4 w-4" aria-hidden="true" />}
            >
              {t('settings.backup.backupNow')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void handleRestore()}
              leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
            >
              {t('settings.backup.restore')}
            </Button>
            <Button variant="destructive" data-testid="reset-data" onClick={() => setResetOpen(true)}>{t('settings.backup.resetData')}</Button>
          </div>
        </>
      )}

      <ConfirmDialog open={resetOpen} title={t('settings.backup.resetData')} message={t('settings.backup.resetWarning')}
        confirmLabel={t('settings.backup.resetConfirm')} cancelLabel={t('common.cancel')} loading={resetting}
        onClose={() => setResetOpen(false)} onConfirm={() => { void (async () => {
          setResetting(true);
          try { await settingsApi.resetOperationalData(); setResetOpen(false); toast.success(t('settings.backup.resetSuccess')); await loadInfo(); window.dispatchEvent(new CustomEvent(LATE_PAYMENTS_EVENT)); }
          catch (error) { toast.error(error instanceof Error ? error.message : String(error)); }
          finally { setResetting(false); }
        })(); }} />
      <ConfirmDialog
        open={restoreStage === 'confirm'}
        title={t('settings.backup.restoreTitle')}
        message={t('settings.backup.restoreWarning')}
        confirmLabel={t('settings.backup.restoreContinue')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => setRestoreStage('info')}
        onClose={() => setRestoreStage('idle')}
      />

      <Modal
        open={restoreStage === 'info'}
        onClose={() => setRestoreStage('idle')}
        title={t('settings.backup.restoreTitle')}
        footer={
          <Button onClick={() => setRestoreStage('idle')}>{t('settings.backup.close')}</Button>
        }
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
            <HardDriveDownload className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 text-body text-foreground">
            <p>{t('settings.backup.restoreInfo')}</p>
            <dl className="mt-3 space-y-2 rounded-md bg-background p-3 text-[12px]">
              <div>
                <dt className="text-muted">{t('settings.backup.selectedBackup')}</dt>
                <dd className="break-all font-mono text-foreground">{restoreFile || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted">{t('settings.backup.dbPath')}</dt>
                <dd className="break-all font-mono text-foreground">{info?.path ?? '—'}</dd>
              </div>
            </dl>
          </div>
        </div>
      </Modal>
    </SettingsSection>
  );
}

export default BackupSection;
