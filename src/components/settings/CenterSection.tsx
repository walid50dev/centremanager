import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, ImageUp, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SettingsSection from './SettingsSection';
import { toast } from '../ui/Toast';
import { settingsApi } from '../../services/settings';
import { useAuthStore } from '../../stores/authStore';
import { pdfCompatibleLogo } from '../../utils/centreLogo';

/** The original upload is limited to 2 MiB. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export interface CenterSectionProps {
  settings: Record<string, string>;
  updateLocal: (patch: Record<string, string>) => void;
}

/** Section 1 — centre identity (name, address, phone, logo). */
export function CenterSection({ settings, updateLocal }: CenterSectionProps) {
  const { t } = useTranslation();
  const setCenterName = useAuthStore((state) => state.setCenterName);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [logo, setLogo] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(false);

  // Re-hydrate whenever the persisted settings change (first load / save).
  useEffect(() => { setName(settings.centre_name || settings.center_name || 'CentreManager'); }, [settings.centre_name, settings.center_name]);
  useEffect(() => { setAddress(settings.center_address ?? ''); }, [settings.center_address]);
  useEffect(() => { setPhone(settings.center_phone ?? ''); }, [settings.center_phone]);
  useEffect(() => { setLogo(settings.centre_logo || settings.center_logo || ''); }, [settings.centre_logo, settings.center_logo]);

  const handleSave = async () => {
    if (!name.trim()) {
      setNameError(true);
      return;
    }

    setNameError(false);
    setSaving(true);
    try {
      await settingsApi.setCentreInfo(name.trim(), logo || null);
      await settingsApi.set('center_address', address.trim());
      await settingsApi.set('center_phone', phone.trim());

      updateLocal({
        centre_name: name.trim(), center_name: name.trim(),
        center_address: address.trim(),
        center_phone: phone.trim(),
      });
      setCenterName(name.trim());
      toast.success(t('settings.center.success'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleLogoSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file
    if (!file) return;

    if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type)) {
      toast.error(t('settings.center.logoInvalid'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t('settings.center.logoTooLarge'));
      return;
    }

    setSaving(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const source = typeof reader.result === 'string' ? reader.result : '';
      if (!source) { setSaving(false); return; }
      try {
        const dataUrl = await pdfCompatibleLogo(source);
        await settingsApi.setCentreInfo(settings.centre_name || settings.center_name || 'CentreManager', dataUrl);
        setLogo(dataUrl);
        updateLocal({ centre_logo: dataUrl, center_logo: dataUrl });
        toast.success(t('settings.center.logoUpdated'));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('common.error'));
      } finally {
        setSaving(false);
      }
    };
    reader.onerror = () => { setSaving(false); toast.error(t('settings.center.logoInvalid')); };
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = async () => {
    setSaving(true);
    try {
      await settingsApi.setCentreInfo(settings.centre_name || settings.center_name || 'CentreManager', null);
      setLogo('');
      updateLocal({ centre_logo: '', center_logo: '' });
      toast.success(t('settings.center.logoRemoved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    } finally { setSaving(false); }
  };

  return (
    <SettingsSection
      icon={<Building2 className="h-[18px] w-[18px]" aria-hidden="true" />}
      title={t('settings.centre_identity')}
      description={t('settings.center.description')}
      defaultOpen
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t('settings.centre_name')}
          required
          value={name}
          error={nameError && !name.trim() ? t('settings.center.nameRequired') : undefined}
          onChange={(event) => { setName(event.target.value); setNameError(false); }}
          placeholder={t('setup.centerNamePlaceholder')}
        />
        <Input
          label={t('settings.center.phone')}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="05 22 00 00 00"
          type="tel"
        />
        <Input
          containerClassName="sm:col-span-2"
          label={t('settings.center.address')}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="12 rue des Écoles"
        />
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {logo ? (
            <img
              src={logo}
              alt={t('settings.logo_preview')}
              className="h-[120px] w-[120px] shrink-0 rounded-lg border border-border object-contain"
            />
          ) : (
            <span className="flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-background text-muted">
              <Building2 className="h-6 w-6" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-btn text-foreground">{t('settings.centre_logo')}</p>
            <p className="text-[12px] text-muted">{t('settings.center.logoHint')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={saving}
                onClick={() => fileInputRef.current?.click()}
                leftIcon={<ImageUp className="h-3.5 w-3.5" aria-hidden="true" />}
              >
                {t('settings.upload_logo')}
              </Button>
              {logo && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={handleRemoveLogo}
                  leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                  {t('settings.remove_logo')}
                </Button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              aria-label={t('settings.upload_logo')}
              onChange={handleLogoSelected}
            />
          </div>
        </div>

        <Button onClick={handleSave} loading={saving} className="sm:self-end">
          {t('settings.save')}
        </Button>
      </div>
    </SettingsSection>
  );
}

export default CenterSection;
