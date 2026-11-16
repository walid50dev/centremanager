import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from './Button';
import Tooltip from './Tooltip';

/** Accessible view action that does not activate a surrounding row/card. */
export default function ViewButton({ onView, testId, name }: {
  onView: () => void;
  testId: string;
  name?: string;
}) {
  const { t } = useTranslation();
  const title = t('actions.view');
  const ariaLabel = name ? `${title} — ${name}` : title;
  return (
    <Tooltip content={title} label={ariaLabel}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={(event) => { event.stopPropagation(); onView(); }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
