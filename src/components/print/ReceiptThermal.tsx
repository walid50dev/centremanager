import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReceiptDocumentData, ReceiptLabels } from './receiptLabels';

/**
 * 80 mm thermal receipt — the till roll, not a sheet of paper.
 *
 * 80 mm = 226.77 pt, 3 mm = 8.5 pt. The height is left to the content
 * (`Page` without a fixed size), which is what a thermal printer expects.
 * Courier everywhere: it matches the dot-matrix look of a till receipt and
 * every character takes the same width, so the dashed rules line up.
 */
const COLORS = {
  foreground: '#0F172A',
  muted: '#64748B',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 9,
    paddingBottom: 9,
    paddingHorizontal: 8,
    fontFamily: 'Courier',
    fontSize: 7,
    color: COLORS.foreground,
  },
  center: { alignItems: 'center' },
  centerName: {
    fontFamily: 'Courier-Bold',
    fontSize: 10,
    textAlign: 'center',
    marginBottom: 2,
  },
  shortHeading: { fontSize: 8, textAlign: 'center', letterSpacing: 1, marginBottom: 2 },
  meta: { fontSize: 7, textAlign: 'center', color: COLORS.muted },
  // Dashed, like the `---` rules of a till receipt.
  rule: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.muted,
    borderStyle: 'dashed',
    marginVertical: 4,
  },
  line: { flexDirection: 'row', marginBottom: 1 },
  lineLabel: { width: 46, fontSize: 7, color: COLORS.muted },
  lineValue: { flex: 1, fontSize: 7 },
  lineValueWide: { flex: 1, fontSize: 8 },
  totalBlock: { alignItems: 'center', marginVertical: 3 },
  totalLabel: { fontFamily: 'Courier-Bold', fontSize: 10, textAlign: 'center' },
  method: { fontSize: 7, textAlign: 'center', marginTop: 2 },
  thanks: { fontSize: 8, textAlign: 'center', marginTop: 2 },
});

/**
 * Courier is monospace, so one line holds a fixed number of characters.
 *
 * react-pdf does **not** grow the auto page height when a `Text` wraps inside a
 * flex row: the extra line is drawn on top of the next block. Splitting the
 * value ourselves keeps every `Text` on a single line, so nothing overlaps and
 * no group name is lost.
 */
export function wrapValue(value: string, maxChars: number): string[] {
  const text = value.trim();
  if (!text) return [''];
  const chunks: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    // Split long unbroken words without losing any characters.
    let rest = word;
    while (rest.length > maxChars) { chunks.push(rest.slice(0, maxChars)); rest = rest.slice(maxChars); }
    current = rest;
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
}

/** `Élève   Yassine El Amrani` — one `View` per PNG-sized line of the value. */
function Field({
  label,
  value,
  maxChars,
  wide = false,
}: {
  label: string;
  value: string;
  maxChars: number;
  wide?: boolean;
}) {
  const chunks = wrapValue(value, maxChars);
  return (
    <>
      {chunks.map((chunk, index) => (
        <View style={styles.line} key={`${label}-${index}`}>
          <Text style={styles.lineLabel}>{index === 0 ? label : ' '}</Text>
          <Text style={wide ? styles.lineValueWide : styles.lineValue}>{chunk}</Text>
        </View>
      ))}
    </>
  );
}

export interface ReceiptThermalProps {
  data: ReceiptDocumentData;
  labels: ReceiptLabels;
  template?: string;
}

export function ReceiptThermalDocument({ data, labels, template = 'thermal' }: ReceiptThermalProps) {
  const width = (template === 'thermal58' ? 58 : 80) * 72 / 25.4;
  const valueChars = Math.floor((width - 16 - 46) / (0.6 * 7));
  const valueWideChars = Math.floor((width - 16 - 46) / (0.6 * 8));
  const itemChars = Math.floor((width - 16) / (0.6 * 7));
  return (
    <Document
      title={`${labels.shortHeading} ${data.receiptNumber}`}
      author={data.centerName}
      subject={`${labels.student}: ${data.studentName}`}
      creator="CentreManager"
    >
      <Page size={{ width, height: 'auto' }} style={styles.page} wrap={false}>
        <View style={styles.center}>
          <Text style={styles.centerName}>{data.centerName}</Text>
          {data.centerPhone ? <Text style={styles.meta}>{data.centerPhone}</Text> : null}
          <Text style={styles.shortHeading}>{labels.shortHeading}</Text>
          <Text style={styles.meta}>{data.receiptNumber}</Text>
          <Text style={styles.meta}>{data.dateText}</Text>
        </View>

        <View style={styles.rule} />

        <Field label={labels.student} value={data.studentName} maxChars={valueWideChars} wide />
        <Field label={labels.level} value={data.studentLevel} maxChars={valueChars} />
        <View style={styles.rule} />
        <Text style={styles.shortHeading}>{labels.paymentDetails}</Text>
        {data.items.map((item, index) => <View key={index} style={{ marginBottom: 3 }}>
          {wrapValue(`${item.subject} | ${item.group} | ${item.month} | ${item.amount}`, itemChars).map((line, lineIndex) => (
            <Text key={lineIndex}>{line}</Text>
          ))}
        </View>)}

        <View style={styles.rule} />

        <View style={styles.totalBlock}>
          <Text style={styles.totalLabel}>
            {labels.total}: {data.amountText}
          </Text>
          {data.methodText ? (
            <Text style={styles.method}>{`${labels.method} ${data.methodText}`}</Text>
          ) : null}
        </View>

        <View style={styles.rule} />

        <Text style={styles.thanks}>{labels.thankYouShort}</Text>
      </Page>
    </Document>
  );
}

export default ReceiptThermalDocument;
