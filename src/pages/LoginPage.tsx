import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import LanguageToggle from '../components/auth/LanguageToggle';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { toast } from '../components/ui/Toast';
import { useUnlockForm } from '../hooks/useUnlockForm';
import { authApi } from '../services/auth';
import { useAuthStore } from '../stores/authStore';
import { localizeAuthError } from '../utils/authErrors';
import { cn } from '../utils/format';

/** Logo + title block shared by the setup and login cards. */
function BrandHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <img src="/logo.svg" alt="" className="mb-3 h-14 w-14" aria-hidden="true" />
      <h1>{title}</h1>
      <p className="mt-1 text-[13px] text-muted">{subtitle}</p>
    </div>
  );
}

/** State 1 — first launch: create the centre + admin password. */
function SetupForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setCenterName = useAuthStore((state) => state.setCenterName);
  const setSetupDone = useAuthStore((state) => state.setSetupDone);
  const login = useAuthStore((state) => state.login);

  const [centerName, setCenterNameInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<{
    centerName?: string;
    password?: string;
    confirmPassword?: string;
  }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!centerName.trim()) next.centerName = t('setup.centerRequired');
    if (password.length < 4) next.password = t('setup.passwordTooShort');
    if (confirmPassword !== password) next.confirmPassword = t('setup.passwordMismatch');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      await authApi.setup(centerName.trim(), password);
      setCenterName(centerName.trim());
      setSetupDone();
      login();
      toast.success(t('setup.success'), t('setup.welcome'));
      navigate('/', { replace: true });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : t('common.error');
      const message = localizeAuthError(rawMessage, t);
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <BrandHeader title={t('setup.welcome')} subtitle={t('setup.subtitle')} />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          label={t('setup.centerName')}
          placeholder={t('setup.centerNamePlaceholder')}
          autoFocus
          autoComplete="organization"
          value={centerName}
          leftIcon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          onChange={(event) => {
            setCenterNameInput(event.target.value);
            setErrors((previous) => ({ ...previous, centerName: undefined }));
          }}
          error={errors.centerName}
        />

        <Input
          type="password"
          label={t('setup.password')}
          hint={t('setup.passwordHint')}
          placeholder="••••••••"
          autoComplete="new-password"
          value={password}
          leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
          onChange={(event) => {
            setPassword(event.target.value);
            setErrors((previous) => ({ ...previous, password: undefined }));
          }}
          error={errors.password}
        />

        <Input
          type="password"
          label={t('setup.confirmPassword')}
          placeholder="••••••••"
          autoComplete="new-password"
          value={confirmPassword}
          leftIcon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
          onChange={(event) => {
            setConfirmPassword(event.target.value);
            setErrors((previous) => ({ ...previous, confirmPassword: undefined }));
          }}
          error={errors.confirmPassword}
        />

        {formError && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive" role="alert">
            {formError}
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          loading={submitting}
          rightIcon={<ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />}
        >
          {t('setup.submit')}
        </Button>
      </form>
    </>
  );
}

/** State 2 — subsequent launches: password login. */
function LoginForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const centerName = useAuthStore((state) => state.centerName);
  const login = useAuthStore((state) => state.login);

  const form = useUnlockForm({
    verify: (password) => authApi.login(password),
    onSuccess: () => {
      login();
      navigate('/', { replace: true });
    },
  });

  const { attempts } = form;

  return (
    <>
      <BrandHeader title={centerName} subtitle={t('login.subtitle')} />

      <form onSubmit={form.handleSubmit} className="flex flex-col gap-4" noValidate>
        <div key={form.shakeKey} className={cn(form.shakeKey > 0 && 'animate-shake')}>
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
        </div>

        {attempts.isLockedOut ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] font-medium text-destructive" role="alert">
            {t('login.tooManyAttempts', { seconds: attempts.secondsRemaining })}
          </p>
        ) : (
          attempts.failures > 0 && (
            <p className="text-[13px] text-warning" role="status">
              {t('login.attemptsLeft', { count: attempts.remainingAttempts })}
            </p>
          )
        )}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          loading={form.submitting}
          disabled={attempts.isLockedOut}
          leftIcon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
        >
          {t('login.submit')}
        </Button>
      </form>
    </>
  );
}

/**
 * Pre-authentication screen. Renders the setup card on a fresh install and the
 * login card afterwards; the lock overlay is handled by `LockScreen` inside the
 * app shell.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const isSetup = useAuthStore((state) => state.isSetup);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // Already signed in (e.g. via the browser back button) — no need to log in.
  if (isSetup && isAuthenticated) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex justify-end p-4">
        <LanguageToggle />
      </div>

      <div className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">
          <div className="card p-6 sm:p-8">{isSetup ? <LoginForm /> : <SetupForm />}</div>
          <p className="mt-4 text-center text-[12px] text-muted">{t('app.tagline')}</p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
