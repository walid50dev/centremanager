import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

export interface EntityModalShellProps {
  open: boolean;
  /** Entity name shown in the title. */
  title: string;
  description?: string;
  /** `id` of the `<form>` the footer button submits. */
  formId: string;
  saving: boolean;
  /** Disables the submit button while the form is incomplete. */
  canSubmit?: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Test hook for the panel and submit button. */
  testId: string;
  zIndex?: number;
  footer?: ReactNode;
}

/** Shared frame for small entities without an existing full form. */
export function EntityModalShell({
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
}: EntityModalShellProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      zIndex={zIndex}
      testId={testId}
      title={title}
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
    </Modal>
  );
}

export default EntityModalShell;
