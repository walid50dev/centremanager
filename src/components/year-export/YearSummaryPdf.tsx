import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { YearSummary } from '../../services/yearExport';
Font.register({ family: 'DejaVu', src: `${import.meta.env.BASE_URL}fonts/DejaVuSans.ttf` });
const styles = StyleSheet.create({
  page: { fontFamily: 'DejaVu', padding: 36, fontSize: 10, color: '#0f172a' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  logo: { width: 48, height: 48, objectFit: 'contain', marginRight: 12 },
  name: { fontSize: 17 }, title: { fontSize: 14, marginBottom: 15 },
  kpi: { flexDirection: 'row', justifyContent: 'space-between', padding: 6, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  table: { marginTop: 20 }, row: { flexDirection: 'row', padding: 6, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  col: { width: '50%' }, small: { width: '25%' },
});
export interface SummaryLabels { title: string; students: string; groups: string; teachers: string; revenue: string; expenses: string; salaries: string; net: string; subject: string; note: string; }
export default function YearSummaryPdf({ summary, centerName, logo, labels, rtl }: { summary: YearSummary; centerName: string; logo: string | null; labels: SummaryLabels; rtl: boolean }) {
  const money = (cents: number) => `${(cents / 100).toFixed(2)} DH`;
  const kpis: Array<[string, string]> = [[labels.students,String(summary.students)],[labels.groups,String(summary.groups)],[labels.teachers,String(summary.teachers)],[labels.revenue,money(summary.revenue_cents)],[labels.expenses,money(summary.expenses_cents)],[labels.salaries,money(summary.salaries_cents)],[labels.net,money(summary.net_cents)]];
  const direction = { flexDirection: rtl ? 'row-reverse' as const : 'row' as const };
  const textDirection = { textAlign: rtl ? 'right' as const : 'left' as const };
  return <Document title={labels.title} author={centerName}><Page size="A4" style={styles.page}>
    <View style={[styles.header, direction]}>{logo && <Image src={logo} style={styles.logo} />}<Text style={styles.name}>{centerName}</Text></View>
    <Text style={[styles.title, { textAlign: rtl ? 'right' : 'left' }]}>{labels.title}</Text>
    {kpis.map(([label, value]) => <View key={label} style={[styles.kpi, direction]}><Text>{label}</Text><Text>{value}</Text></View>)}
    <View style={styles.table}><View style={[styles.row, direction]}><Text style={[styles.col, textDirection]}>{labels.subject}</Text><Text style={[styles.small, textDirection]}>{labels.students}</Text><Text style={[styles.small, textDirection]}>{labels.revenue}</Text></View>
      {summary.subjects.map((subject, index) => <View key={`${subject.name}-${index}`} style={[styles.row, direction]}><Text style={[styles.col, textDirection]}>{subject.name}</Text><Text style={[styles.small, textDirection]}>{subject.students}</Text><Text style={[styles.small, textDirection]}>{money(subject.revenue_cents)}</Text></View>)}
    </View>
    <Text style={{ fontSize: 8, color: '#64748b', marginTop: 10, textAlign: rtl ? 'right' : 'left' }}>{labels.note}</Text>
  </Page></Document>;
}
