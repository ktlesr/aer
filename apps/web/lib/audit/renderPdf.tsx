import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { AuditPacket } from "./packet";
import { formatCost, formatDuration } from "@/lib/format";

// The PDF is the human-readable view of the SAME audit packet the JSON export carries — it shows
// that packet's content_hash verbatim so a reviewer can re-hash the JSON and confirm they match.
// We never hash the PDF bytes; integrity lives in the JSON packet. Built-in fonts only (Helvetica /
// Courier) — no font registration, so rendering is deterministic and needs no network or font files.

// Forensic Ledger palette (petrol-teal seal is the only accent; reserved for verifiable facts).
const SEAL = "#0d7d8c";
const INK = "#16242b";
const MUTED = "#5d6b72";
const BORDER = "#dbe1e3";
const PAPER = "#ffffff";

const SEVERITY_COLOR: Record<string, string> = {
  high: "#b3261e",
  medium: "#9a6700",
  low: "#5d6b72",
};

const s = StyleSheet.create({
  page: {
    backgroundColor: PAPER,
    color: INK,
    paddingTop: 44,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 9,
    lineHeight: 1.4,
  },
  eyebrow: {
    fontFamily: "Courier",
    fontSize: 7,
    letterSpacing: 2,
    color: SEAL,
    textTransform: "uppercase",
  },
  title: { fontFamily: "Helvetica-Bold", fontSize: 20, marginTop: 6 },
  runId: { fontFamily: "Courier", fontSize: 9, color: MUTED, marginTop: 4 },
  rule: { borderBottomWidth: 1, borderBottomColor: BORDER, marginVertical: 14 },
  sealRule: { borderBottomWidth: 2, borderBottomColor: SEAL, marginTop: 14 },

  sectionLabel: {
    fontFamily: "Courier",
    fontSize: 7,
    letterSpacing: 1.5,
    color: MUTED,
    textTransform: "uppercase",
    marginBottom: 8,
  },

  // Fact grid (run summary).
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "25%", marginBottom: 10 },
  cellLabel: { fontFamily: "Courier", fontSize: 6.5, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  cellValue: { fontSize: 10, marginTop: 2 },
  mono: { fontFamily: "Courier" },

  // Integrity seal block.
  seal: {
    borderWidth: 1,
    borderColor: SEAL,
    borderRadius: 3,
    padding: 12,
    marginTop: 4,
  },
  sealHashLabel: { fontFamily: "Courier", fontSize: 6.5, color: SEAL, textTransform: "uppercase", letterSpacing: 1 },
  sealHash: { fontFamily: "Courier", fontSize: 9, color: INK, marginTop: 3 },
  sealMeta: { flexDirection: "row", marginTop: 8 },
  sealMetaItem: { marginRight: 28 },

  // Tables.
  tHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: INK,
    paddingBottom: 4,
  },
  tRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingVertical: 4,
  },
  th: { fontFamily: "Courier", fontSize: 6.5, color: MUTED, textTransform: "uppercase", letterSpacing: 1 },
  td: { fontSize: 8.5 },

  empty: { fontSize: 9, color: MUTED, fontStyle: "italic" },

  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
  },
  footerText: { fontFamily: "Courier", fontSize: 6.5, color: MUTED },
});

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.cell}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={s.cellValue}>{children}</Text>
    </View>
  );
}

function AuditDocument({ packet }: { packet: AuditPacket }) {
  const { run, events, redaction_findings, export: exp } = packet;
  return (
    <Document
      title={`Audit packet ${run.id}`}
      author="Agent Evidence Recorder"
      subject="Audit-ready evidence packet"
    >
      <Page size="A4" style={s.page}>
        {/* Header */}
        <Text style={s.eyebrow}>Agent Evidence Recorder</Text>
        <Text style={s.title}>Audit Evidence Packet</Text>
        <Text style={s.runId}>{run.id}</Text>
        <View style={s.sealRule} />

        {/* Run summary */}
        <View style={{ marginTop: 16 }}>
          <Text style={s.sectionLabel}>Run · {run.agentName}</Text>
          <View style={s.grid}>
            <Cell label="Status">{run.status}</Cell>
            <Cell label="Risk">{run.riskLevel}</Cell>
            <Cell label="Events">{String(run.eventCount)}</Cell>
            <Cell label="Redactions">{String(run.redactionCount)}</Cell>
            <Cell label="Started">{fmt(run.startedAt)}</Cell>
            <Cell label="Ended">{run.endedAt ? fmt(run.endedAt) : "—"}</Cell>
            <Cell label="Duration">{formatDuration(run.durationMs)}</Cell>
            <Cell label="Cost">{formatCost(run.costMicroUsd)}</Cell>
          </View>
        </View>

        {/* Integrity seal — the centerpiece */}
        <View style={{ marginTop: 6 }}>
          <Text style={s.sectionLabel}>Integrity</Text>
          <View style={s.seal}>
            <Text style={s.sealHashLabel}>Content hash</Text>
            <Text style={s.sealHash}>{exp.content_hash}</Text>
            <View style={s.sealMeta}>
              <View style={s.sealMetaItem}>
                <Text style={s.cellLabel}>Generated</Text>
                <Text style={[s.cellValue, s.mono]}>{fmt(exp.generatedAt)}</Text>
              </View>
              <View style={s.sealMetaItem}>
                <Text style={s.cellLabel}>Schema</Text>
                <Text style={[s.cellValue, s.mono]}>v{packet.schema_version}</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={s.rule} />

        {/* Event timeline */}
        <Text style={s.sectionLabel}>Event timeline · {events.length}</Text>
        {events.length === 0 ? (
          <Text style={s.empty}>No events recorded.</Text>
        ) : (
          <View>
            <View style={s.tHead}>
              <Text style={[s.th, { width: "8%" }]}>Seq</Text>
              <Text style={[s.th, { width: "26%" }]}>Type</Text>
              <Text style={[s.th, { width: "40%" }]}>Title</Text>
              <Text style={[s.th, { width: "26%" }]}>Occurred</Text>
            </View>
            {events.map((e) => (
              <View key={e.seq} style={s.tRow} wrap={false}>
                <Text style={[s.td, s.mono, { width: "8%" }]}>{e.seq}</Text>
                <Text style={[s.td, s.mono, { width: "26%" }]}>{e.type}</Text>
                <Text style={[s.td, { width: "40%" }]}>{e.title}</Text>
                <Text style={[s.td, s.mono, { width: "26%" }]}>{fmt(e.occurredAt)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={s.rule} />

        {/* Redaction findings — redacted by default, only the hash is shown, never the raw value */}
        <Text style={s.sectionLabel}>Redaction findings · {redaction_findings.length}</Text>
        {redaction_findings.length === 0 ? (
          <Text style={s.empty}>No sensitive values detected.</Text>
        ) : (
          <View>
            <View style={s.tHead}>
              <Text style={[s.th, { width: "20%" }]}>Type</Text>
              <Text style={[s.th, { width: "14%" }]}>Severity</Text>
              <Text style={[s.th, { width: "30%" }]}>Field</Text>
              <Text style={[s.th, { width: "36%" }]}>Original hash</Text>
            </View>
            {redaction_findings.map((f, i) => (
              <View key={i} style={s.tRow} wrap={false}>
                <Text style={[s.td, s.mono, { width: "20%" }]}>{f.findingType}</Text>
                <Text
                  style={[s.td, s.mono, { width: "14%", color: SEVERITY_COLOR[f.severity] ?? INK }]}
                >
                  {f.severity}
                </Text>
                <Text style={[s.td, s.mono, { width: "30%" }]}>{f.fieldPath}</Text>
                <Text style={[s.td, s.mono, { width: "36%" }]}>{f.originalHash}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Footer on every page */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>
            Redacted view · raw values never stored · verify by re-hashing the JSON packet
          </Text>
          <Text
            style={s.footerText}
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

/** Compact UTC stamp, matching the dashboard's formatDateTime ("YYYY-MM-DD HH:MM:SSZ"). */
function fmt(iso: string): string {
  return `${iso.slice(0, 19).replace("T", " ")}Z`;
}

/** Render an audit packet to PDF bytes. Pure function of the packet — no DB, no clock. */
export async function renderAuditPdf(packet: AuditPacket): Promise<Uint8Array<ArrayBuffer>> {
  // renderToBuffer yields a Node Buffer (ArrayBufferLike-backed); copy into a plain
  // ArrayBuffer-backed Uint8Array so it satisfies the Web `BodyInit` type used by Response.
  return new Uint8Array(await renderToBuffer(<AuditDocument packet={packet} />));
}
