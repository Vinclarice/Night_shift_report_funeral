import type { CSSProperties } from "react";

import type { CremationBatchRow, CremationDocumentKind, CremationPrintPreference } from "@/domain/cremation";

function formatCertificateDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

interface PageProps {
  row: CremationBatchRow;
  preference: CremationPrintPreference;
  date?: string;
}

export function CremationCertificatePage({ row, preference, date = "" }: PageProps) {
  const style = {
    "--cremation-scale": String(preference.scale),
    "--cremation-offset-x": `${preference.offsetXInches}in`,
    "--cremation-offset-y": `${preference.offsetYInches}in`,
  } as CSSProperties;
  return (
    <article className="cremation-document-page cremation-certificate-page" style={style} aria-label={`Cremation certificate for ${row.fullName || "blank row"}`}>
      <div className="cremation-print-transform">
        <span className="certificate-date">{formatCertificateDate(date)}</span>
        <span className="certificate-number">{row.number}</span>
        <span className="certificate-name">{row.fullName}</span>
      </div>
    </article>
  );
}

export function CremationEnvelopePage({ row, preference }: PageProps) {
  const style = {
    "--cremation-scale": String(preference.scale),
    "--cremation-offset-x": `${preference.offsetXInches}in`,
    "--cremation-offset-y": `${preference.offsetYInches}in`,
  } as CSSProperties;
  return (
    <article className="cremation-document-page cremation-envelope-page" style={style} aria-label={`Cremation envelope for ${row.displayName || "blank row"}`}>
      <div className="cremation-print-transform">
        <h1>Certificate of Cremation</h1>
        <strong className="envelope-name">{row.displayName}</strong>
        <span className="envelope-funeral-home">{row.funeralHome}</span>
        {row.location.trim() && <span className="envelope-location">{row.location}</span>}
      </div>
    </article>
  );
}

export function CremationPrintPages({ kind, rows, date, preference }: {
  kind: CremationDocumentKind;
  rows: CremationBatchRow[];
  date: string;
  preference: CremationPrintPreference;
}) {
  return <>{rows.map((row) => {
    return kind === "certificate"
      ? <CremationCertificatePage key={row.id} row={row} date={date} preference={preference} />
      : <CremationEnvelopePage key={row.id} row={row} preference={preference} />;
  })}</>;
}
