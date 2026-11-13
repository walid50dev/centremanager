import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserRound } from 'lucide-react';
import Button from '../ui/Button';
import DuplicateWarnings from '../duplicates/DuplicateWarnings';
import Input from '../ui/Input';
import MoneyInput from '../ui/MoneyInput';
import Modal from '../ui/Modal';
import CreatableEntitySelect from '../ui/CreatableEntitySelect';
import Select from '../ui/Select';
import Textarea from '../ui/Textarea';
import { toast } from '../ui/Toast';
import { levelsApi } from '../../services/settings';
import LevelModal from '../entity-modals/LevelModal';
import BranchModal from '../entity-modals/BranchModal';
import { isValidPhone, studentsApi } from '../../services/students';
import { formatPhone, stripPhone } from '../../utils/format';
import type { Branch, Level, Student, StudentInput } from '../../types';

export interface StudentModalProps {
  open: boolean;
  student?: Student | null;
  onClose: () => void;
  onSaved: () => void;
  onCreated?: (student: { id: number; full_name: string }) => void;
  zIndex?: number;
}

type Form = { first: string; last: string; level: string; branch: string; school: string; birth: string;
  enrollment: string; guardian: string; phone: string; relation: string; secondary: string;
  secondaryPhone: string; cin: string; father: string; mother: string; studentPhone: string; fee: number; status: 'actif' | 'inactif'; address: string; notes: string };
const today = () => new Date().toISOString().split('T')[0];
function toForm(student?: Student | null): Form {
  const names = (student?.full_name ?? '').trim().split(/\s+/);
  return {
    first: student?.first_name ?? names[0] ?? '', last: student?.last_name ?? names.slice(1).join(' '),
    level: student?.level_id ? String(student.level_id) : '', branch: student?.branch_id ? String(student.branch_id) : '',
    school: student?.school_name ?? '', birth: student?.birth_date ?? '', enrollment: student?.enrollment_date || today(),
    guardian: student?.guardian_name ?? '', phone: student?.guardian_phone ? formatPhone(student.guardian_phone) : (student?.phone ? formatPhone(student.phone) : ''),
    studentPhone: student?.phone ? formatPhone(student.phone) : '', fee: student?.enrollment_fee_cents ?? 0,
    cin: student?.cin_tuteur ?? '', father: student?.nom_pere ?? '', mother: student?.nom_mere ?? '',
    relation: student?.guardian_relation ?? '', secondary: student?.secondary_contact_name ?? '',
    secondaryPhone: student?.secondary_contact_phone ? formatPhone(student.secondary_contact_phone) : '',
    status: student?.status ?? 'actif', address: student?.address ?? '', notes: student?.notes ?? '',
  };
}

export function StudentModal({ open, student = null, onClose, onSaved, onCreated, zIndex = 50 }: StudentModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Form>(() => toForm(student));
  const [levels, setLevels] = useState<Level[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [quickLevel, setQuickLevel] = useState(false);
  const [quickBranch, setQuickBranch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  useEffect(() => { if (open) { setForm(toForm(student)); setSubmitting(false); setShowErrors(false); } else { setQuickLevel(false); setQuickBranch(false); } }, [open, student]);
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
    isValidPhone(form.phone) && isValidPhone(form.studentPhone) && Number.isFinite(form.fee) && form.fee >= 0 && (!form.secondaryPhone.trim() || isValidPhone(form.secondaryPhone));
  const relations = useMemo(() => ['father', 'mother', 'guardian', 'brother', 'sister', 'other'].map(value => ({ value, label: t(`students.relation_${value}`) })), [t]);
  const update = (key: keyof Form, value: string | number) => setForm(previous => ({ ...previous, [key]: value, ...(key === 'level' && value !== previous.level ? { branch: '' } : {}) }));
  const save = async () => {
    if (!valid) { setShowErrors(true); return; }
    const phone = stripPhone(form.phone);
    const data: StudentInput = {
      full_name: `${form.first.trim()} ${form.last.trim()}`, first_name: form.first.trim(), last_name: form.last.trim(),
      birth_date: form.birth || null, phone: stripPhone(form.studentPhone), guardian_phone: phone, enrollment_fee_cents: form.fee, guardian_name: form.guardian.trim(),
      cin_tuteur: form.cin.trim() || null, nom_pere: form.father.trim() || null, nom_mere: form.mother.trim() || null,
      guardian_relation: form.relation || null, secondary_contact_name: form.secondary.trim() || null,
      secondary_contact_phone: stripPhone(form.secondaryPhone) || null, school_name: form.school.trim() || null,
      enrollment_date: form.enrollment, level_id: Number(form.level), branch_id: form.branch ? Number(form.branch) : null,
      status: form.status, address: form.address.trim() || null, notes: form.notes.trim() || null,
    };
    setSubmitting(true);
    try {
      if (student) await studentsApi.update(student.id, data); else {
        const id = await studentsApi.create(data);
        onCreated?.({ id, full_name: data.full_name });
      }
      toast.success(t(student ? 'students.toast.updated' : 'students.toast.created'));
      onSaved(); onClose();
    } catch (error) { toast.error(`${t('students.toast.error')} ${error instanceof Error ? error.message : String(error)}`); }
    finally { setSubmitting(false); }
  };
  return <>
    <Modal open={open} onClose={onClose} size="lg" zIndex={zIndex} title={<span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-primary" />{t(student ? 'students.editTitle' : 'students.new')}</span>}
      footer={<><Button variant="secondary" onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button><Button data-testid="student-save" onClick={() => void save()} loading={submitting} disabled={submitting}>{t('students.save')}</Button></>}>
      <form noValidate className="space-y-6" onSubmit={event => { event.preventDefault(); void save(); }}>
        <DuplicateWarnings open={open} type="student" id={student?.id} first={form.first} last={form.last} phone={form.phone} />
        <fieldset data-testid="student-section-identity" className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 text-base font-semibold">{t('students.section_identity')}</legend>
          <Input label={t('students.last_name')} data-testid="student-last-name" error={showErrors && !form.last.trim() ? t('common.required') : undefined} required autoFocus placeholder="El Mansouri / المنصوري" value={form.last} onChange={e => update('last', e.target.value)} />
          <Input label={t('students.first_name')} data-testid="student-first-name" error={showErrors && !form.first.trim() ? t('common.required') : undefined} required placeholder="Salma / سلمى" value={form.first} onChange={e => update('first', e.target.value)} />
          <CreatableEntitySelect testId="student-level" error={showErrors && !form.level ? t('common.required') : undefined} required label={t('students.level')} placeholder={t('students.selectLevel')} options={levels} value={levels.find(l => String(l.id) === form.level) ?? null} onChange={l => update('level', l ? String(l.id) : '')} getOptionLabel={l => `${l.name} (${l.category})`} getOptionValue={l => l.id} onCreate={() => setQuickLevel(true)} disableCreate={zIndex >= 70} searchable />
          <CreatableEntitySelect testId="student-branch" label={t('students.branch')} placeholder={t('students.selectBranch')}
            options={branches} value={branches.find(branch => String(branch.id) === form.branch) ?? null}
            onChange={branch => update('branch', branch ? String(branch.id) : '')} getOptionLabel={branch => branch.name}
            getOptionValue={branch => branch.id} clearable onCreate={() => setQuickBranch(true)} disableCreate={zIndex >= 70} />
          <Input type="tel" dir="ltr" label={t('students.student_phone')} required data-testid="student-phone" value={form.studentPhone} onChange={e => update('studentPhone', e.target.value)} error={showErrors && !form.studentPhone.trim() ? t('common.required') : form.studentPhone && !isValidPhone(form.studentPhone) ? t('students.validation.phoneFormat') : undefined} />
          <Input label={t('students.school_name')} data-testid="student-school-name" placeholder="Lycée Moulay Youssef" value={form.school} onChange={e => update('school', e.target.value)} />
          <Input type="date" label={t('students.birth_date')} data-testid="student-birth-date" value={form.birth} onChange={e => update('birth', e.target.value)} />
          <Input type="date" required label={t('students.enrollment_date')} data-testid="student-enrollment-date" error={showErrors && !form.enrollment ? t('common.required') : undefined} value={form.enrollment} onChange={e => update('enrollment', e.target.value)} />
        </fieldset>
        <fieldset data-testid="student-section-guardian" className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2"><legend className="text-base font-semibold">{t('students.section_guardian')}</legend>
          <Input label={t('students.guardian_name')} data-testid="student-guardian-name" error={showErrors && !form.guardian.trim() ? t('common.required') : undefined} required placeholder="Rachid El Mansouri" value={form.guardian} onChange={e => update('guardian', e.target.value)} />
          <Input type="tel" dir="ltr" label={t('students.guardian_phone')} data-testid="student-guardian-phone" required placeholder="06 61 23 45 67" value={form.phone} onChange={e => update('phone', e.target.value)} onBlur={() => { if (isValidPhone(form.phone)) update('phone', formatPhone(form.phone)); }} error={showErrors && !form.phone.trim() ? t('common.required') : form.phone && !isValidPhone(form.phone) ? t('students.validation.phoneFormat') : undefined} />
          <Input label={t('students.guardianCin')} data-testid="student-cin" value={form.cin} onChange={e => update('cin', e.target.value)} />
          <Input label={t('students.fatherName')} data-testid="student-father" value={form.father} onChange={e => update('father', e.target.value)} />
          <Input label={t('students.motherName')} data-testid="student-mother" value={form.mother} onChange={e => update('mother', e.target.value)} />
          <Select label={t('students.guardian_relation')} data-testid="student-guardian-relation" placeholder="—" options={relations} value={form.relation} onChange={e => update('relation', e.target.value)} />
          <Input label={t('students.secondary_contact')} data-testid="student-secondary-name" value={form.secondary} onChange={e => update('secondary', e.target.value)} />
          <Input type="tel" dir="ltr" label={t('students.secondary_phone')} data-testid="student-secondary-phone" placeholder="06 61 23 45 67" value={form.secondaryPhone} onChange={e => update('secondaryPhone', e.target.value)} onBlur={() => { if (isValidPhone(form.secondaryPhone)) update('secondaryPhone', formatPhone(form.secondaryPhone)); }} error={form.secondaryPhone && !isValidPhone(form.secondaryPhone) ? t('students.validation.phoneFormat') : undefined} />
        </fieldset>
        <fieldset data-testid="student-section-admin" className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2"><legend className="text-base font-semibold">{t('students.section_admin')}</legend>
          <MoneyInput label={t('students.enrollment_fee_dh')} hint={t('students.enrollment_fee_future')} data-testid="student-enrollment-fee" valueCents={form.fee} onChange={value => update('fee', value)} />
          <Select label={t('students.status')} data-testid="student-status" required value={form.status} options={[{ value: 'actif', label: t('students.active') }, { value: 'inactif', label: t('students.inactive') }]} onChange={e => update('status', e.target.value)} />
          <Input label={t('students.address')} data-testid="student-address" placeholder={t('students.address_placeholder')} value={form.address} onChange={e => update('address', e.target.value)} />
          <Textarea containerClassName="sm:col-span-2" label={t('students.notes')} data-testid="student-notes" placeholder={t('students.notes_placeholder')} value={form.notes} onChange={e => update('notes', e.target.value)} rows={3} />
        </fieldset>
      </form>
    </Modal>
    {quickBranch && <BranchModal levels={levels} zIndex={zIndex + 10} onClose={() => setQuickBranch(false)} onCreated={branch => {
      setQuickBranch(false); setBranches(previous => [...previous.filter(row => row.id !== branch.id), branch]);
      update('level', String(branch.level_id)); update('branch', String(branch.id));
      void levelsApi.branches(branch.level_id).then(setBranches).catch(() => {});
    }} />}
    {quickLevel && <LevelModal zIndex={zIndex + 10} onClose={() => setQuickLevel(false)} onCreated={async level => { setQuickLevel(false); setLevels(previous => [...previous.filter(row => row.id !== level.id), level]); update('level', String(level.id)); void levelsApi.list().then(setLevels).catch(() => {}); }} />}
  </>;
}
export default StudentModal;
