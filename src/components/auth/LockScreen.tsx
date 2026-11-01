import { useTranslation } from 'react-i18next';
import { Lock, Unlock } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { toast } from '../ui/Toast';
import { useUnlockForm } from '../../hooks/useUnlockForm';
import { authApi } from '../../services/auth';
import { useAuthStore } from '../../stores/authStore';
import { cn } from '../../utils/format';

/**
 * Full-screen lock overlay (auto-lock after idle, or the header 🔒 button).
 *
 * Renders above the whole shell (`fixed inset-0 z-50`) so no sidebar or page
 * content is reachable behind it, but below the toast viewport (`z-[60]`) and
 * future modals (`z-60+`). The routed page underneath stays mounted, so
 * unlocking returns the user to exactly where they were.
 */
export function LockScreen() {
  const { t } = useTranslation();
  const centerName = useAuthStore((state) => state.centerName);
  const unlock = useAuthStore((state) => state.unlock);

  const form = useUnlockForm({
    verify: (password) => authApi.verifyLockPassword(password),
    onSuccess: () => {
      unlock();
      toast.success(t('lock.success'));
    },
  });

  const { attempts } = form;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('lock.title')}
      data-testid="lock-screen"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 px-4 backdrop-blur"
      onMouseMove={(event) => event.stopPropagation()}
    >
      <div key={form.shakeKey} className={cn('w-full max-w-sm', form.shakeKey > 0 && 'animate-shake')}>
        <div className="card p-6">
          <div className="mb-5 flex flex-col items-center text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Lock className="h-7 w-7" aria-hidden="true" />
            </span>
            <p className="text-[13px] font-medium text-muted">{centerName}</p>
            <h1 className="mt-1">{t('lock.title')}</h1>
            <p className="mt-1 text-[13px] text-muted">{t('lock.subtitle')}</p>
          </div>

          <form onSubmit={form.handleSubmit} className="flex flex-col gap-4">
            <Input
              type="password"
              label={t('login.password')}
              placeholder={t('login.placeholder')}
              autoFocus
              autoComplete="current-password"
              disabled={attempts.isLockedOut}
              value={form.password}
              leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
              onChange={(event) => form.setPassword(event.target.value)}
              error={form.error ?? undefined}
            />

            {attempts.isLockedOut && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive" role="alert">
                {t('login.tooManyAttempts', { seconds: attempts.secondsRemaining })}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              loading={form.submitting}
              disabled={attempts.isLockedOut}
              leftIcon={<Unlock className="h-4 w-4" aria-hidden="true" />}
            >
              {t('lock.unlock')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default LockScreen;
