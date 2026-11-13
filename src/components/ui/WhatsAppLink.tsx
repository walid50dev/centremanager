import { MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '../../services/api';
import { whatsappUrl } from '../../utils/whatsapp';
import { toast } from './Toast';

/** Accessible, prominent external link. Never navigate the containing table row. */
export default function WhatsAppLink({ phone, message, testId, compact = false, label }: {
  phone: string | null | undefined; message?: string; testId?: string; compact?: boolean; label?: string;
}) {
  const { t } = useTranslation();
  const href = whatsappUrl(phone ?? '', message);
  if (!href) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}
    aria-label={compact ? `${t('student.sendWhatsApp')}${label ? ` — ${label}` : ''}` : label || t('student.whatsapp')}
    title={compact ? t('student.sendWhatsApp') : label || t('student.whatsapp')}
    className={compact
      ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white hover:bg-[#1DA851] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700'
      : 'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-[#25D366] px-2 py-1 text-xs font-semibold text-white hover:bg-[#1DA851] focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-700'}
    onKeyDown={e => e.stopPropagation()} onClick={e => {
      e.stopPropagation();
      if (isTauri()) {
        e.preventDefault();
        void import('@tauri-apps/plugin-shell').then(({open}) => open(href)).catch(error => toast.error(error instanceof Error ? error.message : String(error)));
      }
    }}>{compact ? (
      // WhatsApp brand icon from Simple Icons (CC0).
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true" focusable="false">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
      </svg>
    ) : <><MessageCircle className="h-4 w-4" aria-hidden="true" /> {label || t('student.whatsapp')}</>}</a>;
}
