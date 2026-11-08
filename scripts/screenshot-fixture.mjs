// Browser-development fixture only. Never run against real data.
import { devInvoke } from '../src/services/settingsDevBackend.ts';

const KEY = 'centremanager.dev.settings_store_v1';
export async function seedScreenshots({ overwrite = false } = {}) {
  if (!import.meta.env.DEV || window.__TAURI_INTERNALS__) throw new Error('Réservé au navigateur Vite en mode développement.');
  if (!overwrite && (localStorage.getItem(KEY) || localStorage.getItem('centremanager.dev.mock_password_digest'))) {
    throw new Error('Des données dev existent déjà : utilisez un profil navigateur vierge, ou confirmez explicitement overwrite: true.');
  }
  // First build a pristine reference catalogue, then remove only the demo rows.
  localStorage.removeItem(KEY);
  await devInvoke('cmd_get_all_settings');
  const store = JSON.parse(localStorage.getItem(KEY));
  for (const key of ['students', 'groups', 'enrollments', 'invoices', 'payments', 'receipts', 'teachers', 'teacherActivities', 'teacherSettlements', 'expenses', 'auditLog']) store[key] = [];
  for (const key of ['nextStudentId', 'nextGroupId', 'nextScheduleId', 'nextEnrollmentId', 'nextInvoiceId', 'nextPaymentId', 'nextReceiptId', 'nextTeacherId', 'nextActivityId', 'nextSettlementId', 'nextExpenseId', 'nextAuditId']) store[key] = 1;
  Object.assign(store, { studentYears: {}, teacherYears: {}, expenseYears: {}, studentTrashYears: {}, teacherYearTrash: {}, feeHandledYears: {}, groupImports: {} });
  store.settings.center_name = 'Centre Excellence Marrakech';
  localStorage.setItem(KEY, JSON.stringify(store));
  const call = devInvoke;
  const currentYear = await call('cmd_create_school_year', { label: '2025-2026', startDate: '2025-09-01', endDate: '2026-06-30' });
  await call('cmd_switch_school_year', { yearId: currentYear });
  await call('cmd_set_enrollment_fee', { amount: 20000 });
  const teachers = [];
  for (const [name, phone, subject] of [['Prof. Amrani','0661112233',1], ['Prof. Bennani','0662223344',2], ['Prof. Chraibi','0663334455',4]]) {
    teachers.push(await call('cmd_create_teacher', { data: { full_name: name, phone, email: null, notes: 'Enseignant de soutien scolaire', subject_ids: [subject] } }));
  }
  // Groups are displayed by subject + level; the application has no custom group name.
  const groups = [];
  for (const [subject, level, teacher, day, start, end, room, fee] of [
    [1,12,0,'Lundi','16:00','18:00','A1',450], [2,11,1,'Mardi','17:00','19:00','A2',400],
    [4,10,2,'Mercredi','15:00','17:00','B1',350], [3,9,1,'Samedi','10:00','12:00','B2',300],
  ]) {
    groups.push(await call('cmd_create_group', { data: { subject_id: subject, level_id: level, branch_id: null, teacher_id: teachers[teacher], school_year_id: currentYear, day_of_week: day, start_time: start, end_time: end, room, monthly_fee_cents: fee * 100, capacity: 18 } }));
  }
  const students = [];
  const rows = [
    ['Salma','El Mansouri',12,'0661010101','Ahmed El Mansouri',[0]],
    ['Youssef','Benali',11,'0662020202','Khadija Benali',[1]],
    ['Fatima Zahra','Idrissi',10,'0663030303','Mohamed Idrissi',[2]],
    ['Amine','Tazi',9,'0664040404','Samira Tazi',[3]],
    ['Hajar','Fassi',12,'0665050505','Hassan Fassi',[0]],
  ];
  for (const [first_name,last_name,level_id,phone,guardian_name,groupIndexes] of rows) {
    const id = await call('cmd_create_student', { data: { first_name, last_name, level_id, guardian_name, guardian_phone: phone, enrollment_fee_cents: 20000, address: 'Marrakech', enrollment_date: '2025-09-05', status: 'actif' } });
    students.push(id);
    for (const index of groupIndexes) await call('cmd_enroll_student', { studentId: id, groupId: groups[index], startDate: '2025-09-05' });
  }
  const now = new Date(), month = now.getMonth() + 1, year = now.getFullYear();
  await call('cmd_generate_monthly_invoices', { month, year });
  const salma = await call('cmd_get_student_invoices', { studentId: students[0] });
  const youssef = await call('cmd_get_student_invoices', { studentId: students[1] });
  const monthly = list => list.find(i => i.kind !== 'enrollment_fee' && i.period_month === month && i.period_year === year);
  const fully = monthly(salma), partially = monthly(youssef);
  if (!fully || !partially) throw new Error('Factures mensuelles introuvables.');
  const paymentId = await call('cmd_record_payment', { studentId: students[0], invoiceIds: [fully.id], amountCents: fully.amount_cents, method: 'espèces', notes: 'Paiement complet' });
  await call('cmd_create_receipt', { paymentId });
  await call('cmd_record_payment', { studentId: students[1], invoiceIds: [partially.id], amountCents: 15000, method: 'espèces', notes: 'Paiement partiel' });
  for (const [label, amount, category] of [['Loyer du centre', 4500, 'Loyer'], ['Facture électricité', 520, 'Électricité'], ['Abonnement fibre WiFi', 300, 'WiFi']]) {
    await call('cmd_create_expense', { data: { label, amount_cents: amount * 100, category, month, year } });
  }
  const discarded = await call('cmd_create_expense', { data: { label: 'Anciennes fournitures', amount_cents: 12000, category: 'Fournitures', month, year } });
  await call('cmd_delete_to_trash', { entityType: 'expense', entityId: discarded });
  // Include existing pupils in the previous year to populate the import dialog.
  const result = JSON.parse(localStorage.getItem(KEY));
  for (const id of students.slice(0, 2)) result.studentYears[id] = [1, currentYear];
  localStorage.setItem(KEY, JSON.stringify(result));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('admin123'));
  localStorage.setItem('centremanager.dev.mock_password_digest', [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join(''));
  localStorage.setItem('centremanager.dev.mock_center_name', 'Centre Excellence Marrakech');
  localStorage.setItem('centremanager.language', 'fr');
  return { students, teachers, groups, currentYear, paymentId };
}
