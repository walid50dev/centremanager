import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReceiptDocumentData, ReceiptLabels } from './receiptLabels';

const colors = { ink: '#0F172A', muted: '#64748B', border: '#E2E8F0', primary: '#2563EB' };
const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica', fontSize: 10, color: colors.ink },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  identity: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  logo: { width: 60, height: 60, objectFit: 'contain', marginRight: 12 },
  centerName: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  muted: { color: colors.muted, fontSize: 9, marginTop: 3 },
  right: { textAlign: 'right', marginLeft: 16 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.border, marginVertical: 14 },
  section: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginBottom: 8 },
  field: { flexDirection: 'row', marginBottom: 4 },
  fieldLabel: { width: 90, color: colors.muted },
  fieldValue: { flex: 1 },
  tableHead: { flexDirection: 'row', backgroundColor: '#F1F5F9', paddingVertical: 6, paddingHorizontal: 5, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
  subject: { width: '28%', paddingRight: 5 },
  group: { width: '28%', paddingRight: 5 },
  month: { width: '25%', paddingRight: 5 },
  amount: { width: '19%', textAlign: 'right' },
  total: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10, fontFamily: 'Helvetica-Bold', fontSize: 12, color: colors.primary },
  method: { marginTop: 16 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 38 },
  signature: { width: 160, textAlign: 'center', color: colors.muted, fontSize: 9 },
});
export interface ReceiptA4Props { data: ReceiptDocumentData; labels: ReceiptLabels; template?: string }
export function ReceiptA4Document({ data, labels, template = 'a4' }: ReceiptA4Props) {
  return <Document title={`${labels.heading} ${data.receiptNumber}`} author={data.centerName} creator="CentreManager">
    <Page size={template === 'a5' ? 'A5' : 'A4'} style={[styles.page, template === 'a5' ? { padding: 24 } : {}]}>
      <View style={styles.header}>
        <View style={styles.identity}>
          {data.logo ? <Image style={styles.logo} src={data.logo} /> : null}
          <View><Text style={styles.centerName}>{data.centerName}</Text>
            {data.centerAddress ? <Text style={styles.muted}>{data.centerAddress}</Text> : null}
            {data.centerPhone ? <Text style={styles.muted}>{data.centerPhone}</Text> : null}
          </View>
        </View>
        <View style={styles.right}><Text style={styles.title}>{labels.heading}</Text>
          <Text style={styles.muted}>{`${labels.number} ${data.receiptNumber}`}</Text>
          <Text style={styles.muted}>{`${labels.date} ${data.dateText}`}</Text>
        </View>
      </View>
      <View style={styles.rule} />
      <Text style={styles.section}>{labels.studentInfo}</Text>
      <View style={styles.field}><Text style={styles.fieldLabel}>{labels.student}</Text><Text style={styles.fieldValue}>{data.studentName}</Text></View>
      <View style={styles.field}><Text style={styles.fieldLabel}>{labels.level}</Text><Text style={styles.fieldValue}>{data.studentLevel}</Text></View>
      <View style={styles.rule} />
      <Text style={styles.section}>{labels.paymentDetails}</Text>
      <View style={styles.tableHead} fixed><Text style={styles.subject}>{labels.subject}</Text><Text style={styles.group}>{labels.group}</Text><Text style={styles.month}>{labels.month}</Text><Text style={styles.amount}>{labels.amount}</Text></View>
      {data.items.map((item, index) => <View style={styles.row} key={index} wrap={false}>
        <Text style={styles.subject}>{item.subject}</Text><Text style={styles.group}>{item.group}</Text><Text style={styles.month}>{item.month}</Text><Text style={styles.amount}>{item.amount}</Text>
      </View>)}
      <View style={styles.total}><Text>{`${labels.total}  ${data.amountText}`}</Text></View>
      <Text style={styles.method}>{`${labels.method}: ${data.methodText || '—'}`}</Text>
      <View style={styles.footer}><Text>{labels.thanks}</Text><Text style={styles.signature}>{labels.signature}</Text></View>
    </Page>
  </Document>;
}
export default ReceiptA4Document;
