import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

export interface QuickCreateShellProps {
  open: boolean;
  /** Entity name, without the "(rapide)" suffix — used in the title. */
  title: string;
  description?: string;
  /** `id` of the `<form>` the footer button submits. */
  formId: string;
  saving: boolean;
  /** Disables "Créer" while the minimal form is incomplete. */
  canSubmit?: boolean;
  onClose: () => void;
  children: ReactNode;
  /** `quick-create-<entity>` — the panel, its form and its buttons hang off it. */
  testId: string;
  zIndex?: number;
  footer?: ReactNode;
}

/**
 * Frame shared by every quick-create dialog.
 *
 * All of them are the same object: a small modal stacked **above** the form that
 * opened it (`z-60`, or `z-70` when it is opened from another quick-create),
 * two buttons, and the reminder that the parent form is not going anywhere.
 */
export function QuickCreateShell({
  open,
  title,
  description,
  formId,
  saving,
  canSubmit = true,
  onClose,
  children,
  testId,
  zIndex = 60,
  footer,
}: QuickCreateShellProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      zIndex={zIndex}
      testId={testId}
      title={
        <span className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" aria-hidden="true" />
          {title}
        </span>
      }
      description={description}
      footer={
        footer ?? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={saving}
              disabled={!canSubmit || saving}
              data-testid={`${testId}-create`}
            >
              {t('common.create')}
            </Button>
          </>
        )
      }
    >
      {children}
      <p className="mt-3 border-t border-border pt-2 text-[11px] leading-4 text-muted">
        {t('quickCreate.hint')}
      </p>
    </Modal>
  );
}

export default QuickCreateShell;
