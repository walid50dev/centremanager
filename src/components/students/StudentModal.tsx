import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserRound } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import CreatableSelect from '../ui/CreatableSelect';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { toast } from '../ui/Toast';
import { levelsApi } from '../../services/settings';
import QuickCreateLevel from '../quick-create/QuickCreateLevel';
import { isValidPhone, studentsApi } from '../../services/students';
import { formatPhone, stripPhone } from '../../utils/format';
import type { Branch, Level, Student, StudentInput } from '../../types';

export interface StudentModalProps {
  open: boolean;
  student?: Student | null;
  onClose: () => void;
  onSaved: () => void;
}

type Form = { first: string; last: string; level: string; branch: string; school: string; birth: string;
  enrollment: string; guardian: string; phone: string; relation: string; secondary: string;
  secondaryPhone: string; status: 'actif' | 'inactif'; address: string; notes: string };
const today = () => new Date().toISOString().split('T')[0];
function toForm(student?: Student | null): Form {
  const names = (student?.full_name ?? '').trim().split(/\s+/);
  return {
    first: student?.first_name ?? names[0] ?? '', last: student?.last_name ?? names.slice(1).join(' '),
    level: student?.level_id ? String(student.level_id) : '', branch: student?.branch_id ? String(student.branch_id) : '',
    school: student?.school_name ?? '', birth: student?.birth_date ?? '', enrollment: student?.enrollment_date || today(),
    guardian: student?.guardian_name ?? '', phone: student?.phone ? formatPhone(student.phone) : '',
    relation: student?.guardian_relation ?? '', secondary: student?.secondary_contact_name ?? '',
    secondaryPhone: student?.secondary_contact_phone ? formatPhone(student.secondary_contact_phone) : '',
    status: student?.status ?? 'actif', address: student?.address ?? '', notes: student?.notes ?? '',
  };
}

export function StudentModal({ open, student = null, onClose, onSaved }: StudentModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Form>(() => toForm(student));
  const [levels, setLevels] = useState<Level[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [quickLevel, setQuickLevel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { if (open) { setForm(toForm(student)); setSubmitting(false); } }, [open, student]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    levelsApi.list().then(rows => { if (active) setLevels(rows); }).catch(() => {});
    return () => { active = false; };
  }, [open]);
  useEffect(() => {
    if (!open || !form.level) { setBranches([]); return; }
    let active = true;
    levelsApi.branches(Number(form.level)).then(rows => { if (active) setBranches(rows); }).catch(() => { if (active) setBranches([]); });
    return () => { active = false; };
  }, [open, form.level]);
  const valid = form.first.trim() && form.last.trim() && form.level && form.enrollment && form.guardian.trim() &&
    isValidPhone(form.phone) && (!form.secondaryPhone.trim() || isValidPhone(form.secondaryPhone));
  const relations = useMemo(() => ['father', 'mother', 'guardian', 'brother', 'sister', 'other'].map(value => ({ value, label: t(`students.relation_${value}`) })), [t]);
  const update = (key: keyof Form, value: string) => setForm(previous => ({ ...previous, [key]: value, ...(key === 'level' && value !== previous.level ? { branch: '' } : {}) }));
  const save = async () => {
    if (!valid) return;
    const phone = stripPhone(form.phone);
    const data: StudentInput = {
      full_name: `${form.first.trim()} ${form.last.trim()}`, first_name: form.first.trim(), last_name: form.last.trim(),
      birth_date: form.birth || null, phone, guardian_phone: phone, guardian_name: form.guardian.trim(),
      guardian_relation: form.relation || null, secondary_contact_name: form.secondary.trim() || null,
      secondary_contact_phone: stripPhone(form.secondaryPhone) || null, school_name: form.school.trim() || null,
      enrollment_date: form.enrollment, level_id: Number(form.level), branch_id: form.branch ? Number(form.branch) : null,
      status: form.status, address: form.address.trim() || null, notes: form.notes.trim() || null,
    };
    setSubmitting(true);
    try {
      if (student) await studentsApi.update(student.id, data); else await studentsApi.create(data);
      toast.success(t(student ? 'students.toast.updated' : 'students.toast.created'));
      onSaved(); onClose();
    } catch (error) { toast.error(`${t('students.toast.error')} ${error instanceof Error ? error.message : String(error)}`); }
    finally { setSubmitting(false); }
  };
  return <>
    <Modal open={open} onClose={onClose} size="lg" title={<span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-primary" />{t(student ? 'students.editTitle' : 'students.new')}</span>}
      footer={<><Button variant="secondary" onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button><Button data-testid="student-save" onClick={() => void save()} loading={submitting} disabled={!valid}>{t('students.save')}</Button></>}>
      <form className="space-y-6" onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset data-testid="student-section-identity" className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 text-base font-semibold">{t('students.section_identity')}</legend>
          <Input label={t('students.last_name')} data-testid="student-last-name" required autoFocus placeholder="El Mansouri / المنصوري" value={form.last} onChange={e => update('last', e.target.value)} />
          <Input label={t('students.first_name')} data-testid="student-first-name" required placeholder="Salma / سلمى" value={form.first} onChange={e => update('first', e.target.value)} />
          <CreatableSelect testId="student-level" required label={t('students.level')} placeholder={t('students.selectLevel')} options={levels} value={levels.find(l => String(l.id) === form.level) ?? null} onChange={l => update('level', l ? String(l.id) : '')} getOptionLabel={l => `${l.name} (${l.category})`} getOptionValue={l => l.id} onCreate={() => setQuickLevel(true)} />
          <Select label={t('students.branch')} placeholder={t('students.selectBranch')} options={branches.map(b => ({ value: b.id, label: b.name }))} value={form.branch} disabled={!form.level || !branches.length} onChange={e => update('branch', e.target.value)} />
          <Input label={t('students.school_name')} data-testid="student-school-name" placeholder="Lycée Moulay Youssef" value={form.school} onChange={e => update('school', e.target.value)} />
          <Input type="date" label={t('students.birth_date')} data-testid="student-birth-date" value={form.birth} onChange={e => update('birth', e.target.value)} />
          <Input type="date" required label={t('students.enrollment_date')} data-testid="student-enrollment-date" value={form.enrollment} onChange={e => update('enrollment', e.target.value)} />
        </fieldset>
        <fieldset data-testid="student-section-guardian" className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2"><legend className="text-base font-semibold">{t('students.section_guardian')}</legend>
          <Input label={t('students.guardian_name')} data-testid="student-guardian-name" required placeholder="Rachid El Mansouri" value={form.guardian} onChange={e => update('guardian', e.target.value)} />
          <Input type="tel" dir="ltr" label={t('students.guardian_phone')} data-testid="student-guardian-phone" required placeholder="06 61 23 45 67" value={form.phone} onChange={e => update('phone', e.target.value)} onBlur={() => { if (isValidPhone(form.phone)) update('phone', formatPhone(form.phone)); }} error={form.phone && !isValidPhone(form.phone) ? t('students.validation.phoneFormat') : undefined} />
          <Select label={t('students.guardian_relation')} data-testid="student-guardian-relation" placeholder="—" options={relations} value={form.relation} onChange={e => update('relation', e.target.value)} />
          <Input label={t('students.secondary_contact')} data-testid="student-secondary-name" value={form.secondary} onChange={e => update('secondary', e.target.value)} />
          <Input type="tel" dir="ltr" label={t('students.secondary_phone')} data-testid="student-secondary-phone" placeholder="06 61 23 45 67" value={form.secondaryPhone} onChange={e => update('secondaryPhone', e.target.value)} onBlur={() => { if (isValidPhone(form.secondaryPhone)) update('secondaryPhone', formatPhone(form.secondaryPhone)); }} error={form.secondaryPhone && !isValidPhone(form.secondaryPhone) ? t('students.validation.phoneFormat') : undefined} />
        </fieldset>
        <fieldset data-testid="student-section-admin" className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2"><legend className="text-base font-semibold">{t('students.section_admin')}</legend>
          <Select label={t('students.status')} data-testid="student-status" required value={form.status} options={[{ value: 'actif', label: t('students.active') }, { value: 'inactif', label: t('students.inactive') }]} onChange={e => update('status', e.target.value)} />
          <Input label={t('students.address')} data-testid="student-address" placeholder={t('students.address_placeholder')} value={form.address} onChange={e => update('address', e.target.value)} />
          <Textarea containerClassName="sm:col-span-2" label={t('students.notes')} data-testid="student-notes" placeholder={t('students.notes_placeholder')} value={form.notes} onChange={e => update('notes', e.target.value)} rows={3} />
        </fieldset>
      </form>
    </Modal>
    {quickLevel && <QuickCreateLevel onClose={() => setQuickLevel(false)} onCreated={async level => { setQuickLevel(false); setLevels(await levelsApi.list()); update('level', String(level.id)); }} />}
  </>;
}
export default StudentModal;
