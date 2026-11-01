import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../components/ui/Toast';
import { localizeAuthError } from '../utils/authErrors';
import { useLoginAttempts, type LoginAttemptsState } from './useLoginAttempts';

interface UseUnlockFormOptions {
  /** Backend verification (cmd_login or cmd_verify_lock_password). */
  verify: (password: string) => Promise<void>;
  /** Called after a successful verification. */
  onSuccess: () => void;
}

export interface UnlockFormState {
  password: string;
  setPassword: (value: string) => void;
  error: string | null;
  submitting: boolean;
  /** Increments on each failure to replay the shake animation. */
  shakeKey: number;
  attempts: LoginAttemptsState;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}

/**
 * Shared logic for the login form and the lock screen: password field, error
 * message, shake feedback, 3-attempt / 30 s lockout and toast notifications.
 */
export function useUnlockForm({ verify, onSuccess }: UseUnlockFormOptions): UnlockFormState {
  const { t } = useTranslation();
  const attempts = useLoginAttempts();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || attempts.isLockedOut) return;

    if (password.length === 0) {
      setError(t('common.required'));
      return;
    }

    setSubmitting(true);
    try {
      await verify(password);
      attempts.reset();
      setError(null);
      setPassword('');
      onSuccess();
    } catch (submitError) {
      const rawMessage =
        submitError instanceof Error ? submitError.message : t('login.error');
      const message = localizeAuthError(rawMessage, t);
      setError(message);
      setPassword('');
      setShakeKey((key) => key + 1);
      attempts.registerFailure();
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return { password, setPassword, error, submitting, shakeKey, attempts, handleSubmit };
}

export default useUnlockForm;
