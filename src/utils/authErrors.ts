/**
 * The Rust backend returns human-readable French messages (they are part of the
 * command contract). The UI translates the ones it knows about, so an Arabic
 * session never shows a French error, and falls back to the raw message
 * otherwise.
 */
interface Translate {
  (key: string, options?: Record<string, unknown>): string;
}

const KNOWN_ERRORS: Array<{ message: string; key: string }> = [
  { message: 'Mot de passe incorrect', key: 'login.error' },
  { message: 'Ancien mot de passe incorrect', key: 'settings.security.wrongOldPassword' },
  {
    message: "Aucun mot de passe n'est configuré pour ce centre",
    key: 'login.notConfigured',
  },
  { message: 'Le nom du centre est obligatoire', key: 'setup.centerRequired' },
  {
    message: 'Le mot de passe doit contenir au moins 4 caractères',
    key: 'setup.passwordTooShort',
  },
];

const THROTTLE_PREFIX = 'Trop de tentatives. Réessayez dans ';

/** Map a backend error message onto an i18n key when one is known. */
export function localizeAuthError(message: string, t: Translate): string {
  // Backend rate limiting carries a variable delay.
  if (message.startsWith(THROTTLE_PREFIX)) {
    const seconds = Number.parseInt(message.slice(THROTTLE_PREFIX.length), 10);
    return t('login.tooManyAttempts', {
      seconds: Number.isFinite(seconds) ? seconds : 30,
    });
  }

  const known = KNOWN_ERRORS.find((entry) => entry.message === message);
  return known ? t(known.key) : message;
}

export default localizeAuthError;
