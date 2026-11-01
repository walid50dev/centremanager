import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, ImageUp, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SettingsSection from './SettingsSection';
import { toast } from '../ui/Toast';
import { settingsApi } from '../../services/settings';
import { useAuthStore } from '../../stores/authStore';

/** 2 MB is plenty for a centre logo and keeps the settings row small. */
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

  // Re-hydrate whenever the persisted settings change (first load / save).
  useEffect(() => {
    setName(settings.center_name ?? '');
    setAddress(settings.center_address ?? '');
    setPhone(settings.center_phone ?? '');
    setLogo(settings.center_logo ?? '');
  }, [settings.center_name, settings.center_address, settings.center_phone, settings.center_logo]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t('settings.center.nameRequired'));
      return;
    }

    setSaving(true);
    try {
      await settingsApi.set('center_name', name.trim());
      await settingsApi.set('center_address', address.trim());
      await settingsApi.set('center_phone', phone.trim());

      updateLocal({
        center_name: name.trim(),
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

    if (!file.type.startsWith('image/')) {
      toast.error(t('settings.center.logoInvalid'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t('settings.center.logoTooLarge'));
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      try {
        await settingsApi.set('center_logo', dataUrl);
        setLogo(dataUrl);
        updateLocal({ center_logo: dataUrl });
        toast.success(t('settings.center.logoUpdated'));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('common.error'));
      }
    };
    reader.onerror = () => toast.error(t('settings.center.logoInvalid'));
    reader.readAsDataURL(file);
  };

  const handleRemoveLogo = async () => {
    try {
      await settingsApi.set('center_logo', '');
      setLogo('');
      updateLocal({ center_logo: '' });
      toast.success(t('settings.center.logoRemoved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
    }
  };

  return (
    <SettingsSection
      icon={<Building2 className="h-[18px] w-[18px]" aria-hidden="true" />}
      title={t('settings.section.center')}
      description={t('settings.center.description')}
      defaultOpen
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t('settings.center.name')}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('setup.centerNamePlaceholder')}
        />
        <Input
          label={t('settings.center.phone')}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="+212 5 22 00 00 00"
          type="tel"
        />
        <Input
          containerClassName="sm:col-span-2"
          label={t('settings.center.address')}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="12 rue des Écoles, Casablanca"
        />
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {logo ? (
            <img
              src={logo}
              alt={t('settings.center.logo')}
              className="h-20 w-20 rounded-lg border border-border object-cover"
            />
          ) : (
            <span className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-border bg-background text-muted">
              <Building2 className="h-6 w-6" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-btn text-foreground">{t('settings.center.logo')}</p>
            <p className="text-[12px] text-muted">{t('settings.center.logoHint')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                leftIcon={<ImageUp className="h-3.5 w-3.5" aria-hidden="true" />}
              >
                {t('settings.center.chooseLogo')}
              </Button>
              {logo && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleRemoveLogo}
                  leftIcon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                  {t('settings.center.removeLogo')}
                </Button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label={t('settings.center.chooseLogo')}
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
