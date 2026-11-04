import { settingsApi } from '../../services/settings';
import { yearExportApi, safeFile } from '../../services/yearExport';
import { pdfCompatibleLogo } from '../../utils/centreLogo';
import type { SummaryLabels } from './YearSummaryPdf';
export async function buildYearPdf(yearId: number, labels: SummaryLabels, rtl: boolean): Promise<Blob> {
  const [summary, center, { pdf }, { default: Pdf }] = await Promise.all([
    yearExportApi.summary(yearId), settingsApi.getCentreInfo(), import('@react-pdf/renderer'), import('./YearSummaryPdf'),
  ]);
  const logo = center.logo ? await pdfCompatibleLogo(center.logo) : null;
  return pdf(<Pdf summary={summary} centerName={center.name} logo={logo} labels={labels} rtl={rtl} />).toBlob();
}
export async function downloadYearPdf(yearId: number, yearLabel: string, labels: SummaryLabels, rtl: boolean) {
  const blob = await buildYearPdf(yearId, labels, rtl);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `resume_${safeFile(yearLabel)}.pdf`;
  document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
