import { MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '../../services/api';
import { whatsappUrl } from '../../utils/whatsapp';
import { toast } from './Toast';

/** Accessible, prominent external link. Never navigate the containing table row. */
export default function WhatsAppLink({ phone, message, testId }: { phone: string | null | undefined; message: string; testId?: string }) {
  const { t } = useTranslation();
  const href = whatsappUrl(phone ?? '', message);
  if (!href) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}
    aria-label={t('student.whatsapp')} title={t('student.whatsapp')}
    className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-700"
    onKeyDown={e => e.stopPropagation()} onClick={e => {
      e.stopPropagation();
      if (isTauri()) {
        e.preventDefault();
        void import('@tauri-apps/plugin-shell').then(({open}) => open(href)).catch(error => toast.error(error instanceof Error ? error.message : String(error)));
      }
    }}><MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp</a>;
}
