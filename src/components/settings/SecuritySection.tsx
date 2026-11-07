import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Lock } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
import SettingsSection from './SettingsSection';
import { toast } from '../ui/Toast';
import { authApi } from '../../services/auth';
import { localizeAuthError } from '../../utils/authErrors';
import { LOCK_TIMEOUT_OPTIONS, readLockTimeout, writeLockTimeout } from '../../utils/lockTimeout';

/** Section 7 — idle lock delay and password change. */
export function SecuritySection() {
  const { t } = useTranslation();

  const [timeoutMinutes, setTimeoutMinutes] = useState<number>(() => readLockTimeout());
  const [savingTimeout, setSavingTimeout] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    oldPassword?: string;
    newPassword?: string;
    confirmPassword?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);

  // Keep the select in sync if the value is changed elsewhere.
  useEffect(() => {
    setTimeoutMinutes(readLockTimeout());
  }, []);

  const resetForm = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setFieldErrors({});
  };

  const closeModal = () => {
    setModalOpen(false);
    resetForm();
  };

  const handleTimeoutChange = async (minutes: number) => {
    setTimeoutMinutes(minutes);
    setSavingTimeout(true);
    try {
      await writeLockTimeout(minutes);
      toast.success(t('settings.security.timeoutUpdated'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setSavingTimeout(false);
    }
  };

  const handleChangePassword = async () => {
    const nextErrors: typeof fieldErrors = {};
    if (!oldPassword) nextErrors.oldPassword = t('settings.security.required');
    if (newPassword.length < 4) nextErrors.newPassword = t('settings.security.tooShort');
    if (!confirmPassword) nextErrors.confirmPassword = t('common.required');
    else if (confirmPassword !== newPassword) {
      nextErrors.confirmPassword = t('settings.security.mismatch');
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await authApi.changePassword(oldPassword, newPassword);
      toast.success(t('settings.security.success'));
      closeModal();
    } catch (error) {
      const raw = error instanceof Error ? error.message : t('common.error');
      const message = localizeAuthError(raw, t);
      toast.error(message);
      setFieldErrors({ oldPassword: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsSection
      icon={<Lock className="h-[18px] w-[18px]" aria-hidden="true" />}
      title={t('settings.section.security')}
      description={t('settings.security.description')}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <Select
          label={t('settings.security.lockTimeout')}
          containerClassName="sm:max-w-xs"
          value={timeoutMinutes}
          disabled={savingTimeout}
          options={LOCK_TIMEOUT_OPTIONS.map((option) => ({
            value: option,
            label:
              option === 0
                ? t('settings.security.disabled')
                : t('settings.security.minutes', { count: option }),
          }))}
          onChange={(event) => void handleTimeoutChange(Number(event.target.value))}
        />
        <Button
          variant="secondary"
          onClick={() => setModalOpen(true)}
          leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
        >
          {t('settings.security.changePassword')}
        </Button>
      </div>

      <p className="mt-3 text-[12px] text-muted">{t('settings.security.timeoutHint')}</p>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={t('settings.security.changePassword')}
        description={t('settings.security.passwordModalHint')}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleChangePassword()} loading={submitting}>
              {t('settings.security.submit')}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void handleChangePassword();
          }}
        >
          <Input
            type="password"
            label={t('settings.security.oldPassword')}
            required
            autoFocus
            autoComplete="current-password"
            value={oldPassword}
            onChange={(event) => {
              setOldPassword(event.target.value);
              setFieldErrors((previous) => ({ ...previous, oldPassword: undefined }));
            }}
            error={fieldErrors.oldPassword}
            leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
          />
          <Input
            type="password"
            label={t('settings.security.newPassword')}
            required
            hint={t('settings.security.tooShort')}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              setFieldErrors((previous) => ({ ...previous, newPassword: undefined }));
            }}
            error={fieldErrors.newPassword}
            leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
          />
          <Input
            type="password"
            label={t('settings.security.confirmPassword')}
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              setFieldErrors((previous) => ({ ...previous, confirmPassword: undefined }));
            }}
            error={fieldErrors.confirmPassword}
            leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
          />
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      </Modal>
    </SettingsSection>
  );
}

export default SecuritySection;
