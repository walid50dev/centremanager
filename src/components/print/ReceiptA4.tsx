import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReceiptDocumentData, ReceiptLabels } from './receiptLabels';

/**
 * A4 receipt — the paper format, 20 mm margins.
 *
 * Colours come from the design system (`tailwind.config.ts`) so a printed
 * receipt and the screen next to it agree on what is important: the amount is
 * the only coloured element on the page.
 */
const COLORS = {
  primary: '#2563EB',
  foreground: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  white: '#FFFFFF',
};

const styles = StyleSheet.create({
  page: {
    // 20 mm on every side (1 mm = 2.8346 pt).
    padding: 57,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: COLORS.foreground,
    backgroundColor: COLORS.white,
  },
  header: { alignItems: 'center' },
  logo: { maxWidth: 60, maxHeight: 60, marginBottom: 8, objectFit: 'contain' },
  centerName: { fontSize: 18, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  centerLine: { fontSize: 10, color: COLORS.muted, textAlign: 'center', marginTop: 2 },
  rule: { borderBottomWidth: 1, borderBottomColor: COLORS.border, marginVertical: 14 },
  title: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    letterSpacing: 1,
    marginBottom: 12,
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoText: { fontSize: 10, color: COLORS.muted },
  infoValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: COLORS.foreground },
  fields: { marginTop: 14 },
  field: { flexDirection: 'row', marginBottom: 5 },
  fieldLabel: { width: 70, fontSize: 11, color: COLORS.muted },
  fieldValue: { flex: 1, fontSize: 11 },
  amountBlock: { alignItems: 'center', paddingVertical: 8 },
  amountLabel: { fontSize: 10, color: COLORS.muted },
  amountValue: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: COLORS.primary, marginTop: 4 },
  method: { fontSize: 10, marginTop: 8 },
  footer: { alignItems: 'center' },
  footerText: { fontSize: 9, color: COLORS.muted, textAlign: 'center', marginTop: 3 },
});

export interface ReceiptA4Props {
  data: ReceiptDocumentData;
  labels: ReceiptLabels;
}

export function ReceiptA4Document({ data, labels }: ReceiptA4Props) {
  return (
    <Document
      title={`${labels.heading} ${data.receiptNumber}`}
      author={data.centerName}
      subject={`${labels.student}: ${data.studentName}`}
      creator="CentreManager"
    >
      {/* No `wrap={false}` here: combined with an auto height it makes
          @react-pdf shrink the page to the content instead of keeping A4. */}
      <Page size="A4" style={styles.page}>
        {/* ---------------------------------------------------------- header */}
        <View style={styles.header}>
          {data.logo ? <Image style={styles.logo} src={data.logo} /> : null}
          <Text style={styles.centerName}>{data.centerName}</Text>
          {data.centerAddress ? <Text style={styles.centerLine}>{data.centerAddress}</Text> : null}
          {data.centerPhone ? <Text style={styles.centerLine}>{data.centerPhone}</Text> : null}
        </View>

        <View style={styles.rule} />

        <Text style={styles.title}>{labels.heading}</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoText}>
            {labels.number} {data.receiptNumber}
          </Text>
          <Text style={styles.infoText}>
            {labels.date} {data.dateText}
          </Text>
        </View>

        <View style={styles.fields}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{labels.student}</Text>
            <Text style={styles.fieldValue}>{data.studentName}</Text>
          </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{labels.groups}</Text>
            <Text style={styles.fieldValue}>{data.groupsText}</Text>
          </View>
          {data.periodText ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{labels.period}</Text>
              <Text style={styles.fieldValue}>{data.periodText}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.rule} />

        <View style={styles.amountBlock}>
          <Text style={styles.amountLabel}>{labels.amount}</Text>
          <Text style={styles.amountValue}>{data.amountText}</Text>
          {data.methodText ? (
            // One string on purpose: two JSX expressions lose the space
            // between them in the PDF text layout.
            <Text style={styles.method}>{`${labels.method} ${data.methodText}`}</Text>
          ) : null}
        </View>

        <View style={styles.rule} />

        <View style={styles.footer}>
          <Text style={styles.footerText}>{labels.thanks}</Text>
          <Text style={styles.footerText}>{data.centerName}</Text>
        </View>
      </Page>
    </Document>
  );
}

export default ReceiptA4Document;
