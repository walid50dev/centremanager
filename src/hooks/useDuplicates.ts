import { useEffect, useState } from 'react';
import { duplicatesApi, type DuplicateEntityType } from '../services/duplicates';
import type { DuplicateMatch } from '../types';

/** Debounces requests and ignores results for old inputs or a closed modal. */
export function useDuplicates(open: boolean, type: DuplicateEntityType, id: number | null, first: string, last: string, phone: string) {
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [ignored, setIgnored] = useState<number[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setMatches([]);
    setIgnored([]);
    setError(false);
    const digits = phone.replace(/[^0-9]/g, '');
    if (!open || (!(first.trim() && last.trim()) && digits.length < 10)) return () => { active = false; };
    const timer = window.setTimeout(() => {
      duplicatesApi.check(type, { id, first_name: first, last_name: last, phone: phone || null })
        .then(rows => { if (active) setMatches(rows); })
        .catch(() => { if (active) setError(true); });
    }, 500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, type, id, first, last, phone]);
  return { matches: matches.filter(match => !ignored.includes(match.entity_id)), error,
    ignore: (entityId: number) => setIgnored(previous => [...previous, entityId]) };
}
