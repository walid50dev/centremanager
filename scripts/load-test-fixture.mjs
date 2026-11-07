// Synthetic load-test data for an isolated Vite browser profile only.
// No real Tauri database is accessed, and existing browser data is never reset
// unless the caller explicitly opts in with overwrite: true.
import { devInvoke } from '../src/services/settingsDevBackend.ts';

const KEY = 'centremanager.dev.settings_store_v1';
const AUTH = 'centremanager.dev.mock_password_digest';
const p2 = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;

export function buildLoadTestStore(base, now = new Date()) {
  // September–August is used so a test year is available throughout the year.
  const startYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear()-1;
  const start = `${startYear}-09-01`, yearId = 1;
  const months = [];
  for (let offset=2; offset>=0; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth()-offset, 1);
    if (iso(d) >= start) months.push(d);
  }
  const stamp = `${iso(now)} 09:00:00`;
  const store = {...base, settings:{...base.settings, center_name:'Centre Test Marrakech', [`enrollment_fee:${yearId}`]:'20000'},
    schoolYears:[{id:1,label:`${startYear}-${startYear+1}`,start_date:start,end_date:`${startYear+1}-08-31`,is_active:true},
      {id:2,label:`${startYear-1}-${startYear}`,start_date:`${startYear-1}-09-01`,end_date:`${startYear}-08-31`,is_active:false}],
    students:[],teachers:[],groups:[],enrollments:[],invoices:[],payments:[],receipts:[],teacherActivities:[],teacherSettlements:[],expenses:[],auditLog:[],
    studentYears:{},teacherYears:{},teacherYearTrash:{},studentTrashYears:{},expenseYears:{},feeHandledYears:{},groupImports:{},nextYearId:3,nextReceiptId:1,nextAuditId:1,nextActivityId:1};
  const first = ['Amine','Salma','Youssef','Mehdi','Oumaima','Aya','Hamza','Imane','Khadija','Adam','Nour','Mohamed','Sara','Anas','Meryem','Omar','Hajar','Rania','Yassine','Fatima Zahra','Zakaria','Nadia','Sofia','Ilyas','Soukaina','Aymane','Mouna','Rayane','Amina','Lina'];
  const last = ['Bennani','Tazi','Alami','Chraibi','Berrada','El Amrani','Benjelloun','Idrissi','Alaoui','Fassi','El Mansouri','Saidi','Belkacem','Aït Lahcen','Bennis','Kabbaj','Mansouri','Ouazzani','Lahlou','Cherkaoui'];
  const arabicFirst = ['أمين','سلمى','يوسف','مهدي','أميمة','آية','حمزة','إيمان','خديجة','آدم'];
  const arabicLast = ['البناني','التازي','العلمي','الشرايبي','برادة','العمراني','بنجلون','الإدريسي','العلوي','الفاسي'];
  const teachers = ['Prof. El Amrani','Prof. Benjelloun','Prof. Chraibi','Prof. Smith','Prof. Alaoui','Prof. Idrissi'];
  const subjectIds = [1,2,3,6,4,5], levels = [12,11,10,9,8,6,5];
  teachers.forEach((name,i) => {
    const id=i+1;
    store.teachers.push({id,full_name:name,phone:`0672${String(100000+i).padStart(6,'0')}`,email:null,notes:'Données synthétiques de test',status:'actif',subject_ids:[subjectIds[i]],compensation_mode:i%2?'percentage':'fixed_monthly',compensation_value_cents:i%2?3500:350000,bonus_pct:null,created_at:stamp,updated_at:stamp});
    store.teacherYears[id]=[yearId];
  });
  const days=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
  let scheduleId=1;
  for(let i=0;i<14;i++) {
    const id=i+1, levelId=levels[Math.floor(i/2)], subjectId=subjectIds[i%6], teacherId=(i%6)+1;
    const day=days[i%7], hour=9+2*Math.floor(i/7), from=`${p2(hour)}:00`, to=`${p2(hour+2)}:00`;
    const schedules = i>=12 ? [] : [{id:scheduleId++,day_of_week:day,start_time:from,end_time:to}];
    store.groups.push({id,subject_id:subjectId,subject_name:store.subjects.find(x=>x.id===subjectId)?.name ?? '',level_id:levelId,level_name:store.levels.find(x=>x.id===levelId)?.name ?? '',branch_id:null,branch_name:null,teacher_id:teacherId,teacher_name:teachers[teacherId-1],school_year_id:yearId,day_of_week:schedules.length?day:'',start_time:schedules.length?from:'',end_time:schedules.length?to:'',room:`Salle ${1+(i%4)}`,monthly_fee_cents:[20000,25000,30000,40000][i%4],capacity:50,enrolled_count:0,status:'actif',schedules,schedule_text:''});
  }
  let enrollmentId=1, invoiceId=1, paymentId=1;
  const payment = (studentId,invoice,amount,date,method='espèces') => {
    if(amount<=0)return;
    store.payments.push({id:paymentId++,student_id:studentId,invoice_id:invoice,school_year_id:yearId,amount_cents:amount,payment_method:method,notes:'Données de test',batch_id:null,created_at:`${date} 10:30:00`});
  };
  for(let i=0;i<200;i++) {
    const id=i+1, levelId=levels[i%levels.length], arabic=i%5===0;
    const name=arabic?arabicFirst[Math.floor(i/5)%10]:first[i%first.length];
    const family=arabic?arabicLast[Math.floor(i/50)%10]:last[Math.floor(i/first.length)%last.length];
    const phone=`0661${String(100000+i).padStart(6,'0')}`;
    const guardian=arabic?`${i%3===1?'فاطمة':'محمد'} ${family}`:`${i%3===1?'Khadija':'Ahmed'} ${family}`;
    store.students.push({id,first_name:name,last_name:family,full_name:`${name} ${family}`,birth_date:`${2008+i%8}-${p2(i%12+1)}-${p2(i%27+1)}`,phone,guardian_name:guardian,guardian_phone:phone,guardian_relation:['father','mother','guardian'][i%3],secondary_contact_name:null,secondary_contact_phone:null,school_name:['Lycée Hassan II','Collège Ibn Sina','École Al Amal'][i%3],enrollment_date:start,level_id:levelId,level_name:store.levels.find(l=>l.id===levelId)?.name ?? '',branch_id:null,branch_name:null,address:['Guéliz, Marrakech','Massira, Marrakech','Targa, Marrakech'][i%3],notes:'Profil fictif pour test de charge',status:'actif',created_at:`${start} 09:00:00`,updated_at:stamp});
    store.studentYears[id]=[yearId]; store.feeHandledYears[`${id}:${yearId}`]=true;
    const primary=(i%7)*2+Math.floor(i/7)%2+1;
    const groupIds=[primary]; if(i%2===0) groupIds.push(primary%2?primary+1:primary-1);
    for(const groupId of groupIds) {
      const enrollment={id:enrollmentId++,student_id:id,group_id:groupId,start_date:start,end_date:null,status:'actif'}; store.enrollments.push(enrollment);
      const group=store.groups[groupId-1]; group.enrolled_count++;
      months.forEach((d,monthIndex) => {
        const current=monthIndex===months.length-1, amount=group.monthly_fee_cents;
        // The final period is exactly 70% paid, 15% partial, 15% unpaid per student.
        const bucket=i%20, paid=current?(bucket<14?amount:bucket<17?Math.floor(amount/2):0):amount;
        const dueDay=current ? Math.max(1,Math.min(now.getDate()-1,5)) : 5;
        const due = new Date(d.getFullYear(),d.getMonth(),dueDay);
        if(current && now.getDate()===1) due.setDate(0);
        const invoice={id:invoiceId++,enrollment_id:enrollment.id,period_month:d.getMonth()+1,period_year:d.getFullYear(),amount_cents:amount,paid_amount_cents:paid,status:paid===amount?'payé':paid?'partiel':'impayé',due_date:iso(due),created_at:`${iso(d)} 08:00:00`};
        store.invoices.push(invoice); payment(id,invoice.id,paid,iso(due),['espèces','virement','chèque'][i%3]);
      });
    }
    if(i<180) {
      const invoice={id:invoiceId++,enrollment_id:null,fee_student_id:id,fee_school_year_id:yearId,type:'frais_inscription',period_month:9,period_year:startYear,amount_cents:20000,paid_amount_cents:20000,status:'payé',due_date:start,created_at:`${start} 08:00:00`};
      store.invoices.push(invoice); payment(id,invoice.id,20000,start);
    }
  }
  const expenseNames=[['Loyer du centre',4500,'Loyer'],['Facture Redal',650,'Électricité'],['Fibre Internet',350,'WiFi'],['Fournitures de bureau',1200,'Fournitures'],['Eau',260,'Eau'],['Assistance administrative',2200,'Assistance'],['Entretien',450,'Autre'],['Impressions',320,'Fournitures'],['Manuels scolaires',800,'Fournitures'],['Téléphone',180,'Autre'],['Nettoyage',500,'Autre'],['Maintenance',750,'Autre']];
  expenseNames.forEach(([label,amount,category],i)=>{ const id=i+1,d=months[i%months.length]; store.expenses.push({id,label,amount_cents:amount*100,category,month:d.getMonth()+1,year:d.getFullYear(),notes:'Données de test',created_at:`${iso(d)} 10:00:00`}); store.expenseYears[id]=yearId; });
  teachers.forEach((_,i)=>store.teacherSettlements.push({id:i+1,teacher_id:i+1,amount_cents:[250000,300000,180000][i%3],payment_method:['espèces','virement','chèque'][i%3],notes:'Paiement manuel de test',month:now.getMonth()+1,year:now.getFullYear(),payment_date:iso(now),school_year_id:yearId,created_at:stamp}));
  Object.assign(store,{nextStudentId:201,nextTeacherId:7,nextGroupId:15,nextScheduleId:scheduleId,nextEnrollmentId:enrollmentId,nextInvoiceId:invoiceId,nextPaymentId:paymentId,nextSettlementId:7,nextExpenseId:13});
  return store;
}

export async function seedLoadTest({overwrite=false, now=new Date()}={}) {
  if (!import.meta.env.DEV || window.__TAURI_INTERNALS__) throw new Error('Réservé au navigateur de développement, jamais à Tauri.');
  if (!overwrite && (localStorage.getItem(KEY) || localStorage.getItem(AUTH))) return false;
  // Construct from the reference catalogue in an empty dev store. Restore the
  // original store on any error; commit the final dataset in a single write.
  const original=localStorage.getItem(KEY);
  try {
    localStorage.removeItem(KEY);
    await devInvoke('cmd_get_all_settings');
    const base=JSON.parse(localStorage.getItem(KEY));
    const store=buildLoadTestStore(base,now);
    localStorage.setItem(KEY,JSON.stringify(store));
    return true;
  } catch(error) {
    if(original===null) localStorage.removeItem(KEY); else localStorage.setItem(KEY,original);
    throw error;
  }
}

/** Apply the checked-in, fixed load-test dataset once per browser profile.
 * A snapshot is retained before replacing any existing development data.
 */
export async function applyBundledLoadTest() {
  if (!import.meta.env.DEV || window.__TAURI_INTERNALS__) throw new Error('Réservé au navigateur de développement.');
  const marker = 'centremanager.dev.load-test-applied-v1';
  const previous = 'centremanager.dev.pre-load-test-backup-v1';
  const original = localStorage.getItem(KEY);
  if (localStorage.getItem(marker) === '1' && original !== null) return false;
  const {default: fixture} = await import('../test-data/centremanager-charge.json');
  if (original !== null && localStorage.getItem(previous) === null) localStorage.setItem(previous, original);
  try {
    localStorage.setItem(KEY, JSON.stringify(fixture));
    localStorage.setItem(marker, '1');
  } catch (error) {
    // If quota or storage access fails, don't leave a partial reset behind.
    localStorage.removeItem(KEY);
    if (original !== null) localStorage.setItem(KEY, original);
    throw error;
  }
  return true;
}
