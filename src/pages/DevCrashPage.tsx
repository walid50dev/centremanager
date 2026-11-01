/**
 * Development-only screen that throws on render.
 *
 * It exists so the `ErrorBoundary` around every route can be exercised (and
 * demonstrated) without breaking a real page. The route that mounts it is only
 * registered when `import.meta.env.DEV` is true, so it never ships.
 */
export function DevCrashPage(): JSX.Element {
  throw new Error('Boom — page de test pour la frontière d’erreur (dev uniquement)');
}

export default DevCrashPage;
