import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, type Timestamp } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import {
  GOCARDLESS_BACKEND_BASE_URL,
  downloadSignedContractFromBackend,
  getGoCardlessSubscriptionStatusFromBackend,
  getSignatureStatusFromBackend,
} from "../../lib/gocardless-backend";

type MaintenanceDoc = {
  id: string;
  clientId?: string;
  clientName?: string;
  clientContact?: { email?: string };
  signerEmail?: string;
  status?: string; // aprogrammer, programmé, terminé...
  equipmentName?: string;
  contractNumber?: string;
  yousignRequestId?: string;
  signatureStatus?: "pending" | "signed" | "declined" | "expired";
  signatureDate?: string;
  lastMaintenance?: string; // YYYY-MM-DD
  nextMaintenance?: string; // YYYY-MM-DD
  paymentMethod?: "gocardless" | "manual";
  paymentDate?: number;
  monthlyAmount?: number;
  gocardlessMandateId?: string;
  gocardlessSubscriptionId?: string;
  subscriptionId?: string; // legacy naming used by backend helpers
  subscriptionStatus?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type MaintenanceUploadedDoc = {
  id: string;
  maintenanceId: string;
  name?: string;
  url?: string;
  storagePath?: string;
  size?: number;
  uploadedAt?: string;
  kind?: string;
  message?: string;
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 22,
  boxShadow: "var(--shadow-sm)",
};

function fmtDate(ts?: Timestamp): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleDateString("fr-FR");
  } catch {
    return "—";
  }
}

function bytesToMb(size?: number): string {
  if (!size || size <= 0) return "";
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

function fmtYmd(ymd?: string): string {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("fr-FR");
}

export function ClientMaintenanceDashboard({
  clientId,
  firebaseUserEmail,
}: {
  clientId: string | null;
  firebaseUserEmail: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [maintenance, setMaintenance] = useState<MaintenanceDoc | null>(null);
  const [docs, setDocs] = useState<MaintenanceUploadedDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [liveSignature, setLiveSignature] = useState<MaintenanceDoc["signatureStatus"]>();
  const [liveSignedAt, setLiveSignedAt] = useState<string | null>();
  const [gcStatus, setGcStatus] = useState<string | null>(null);
  const [gcNextChargeDate, setGcNextChargeDate] = useState<string | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sendingWelcome, setSendingWelcome] = useState(false);
  const [welcomeStatus, setWelcomeStatus] = useState<null | { ok: boolean; message: string }>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!clientId && !firebaseUserEmail) {
        setLoading(false);
        setMaintenance(null);
        setDocs([]);
        setError("Identifiant client introuvable.");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const maintenancesRef = collection(db, "maintenances");
        const qrys: Array<ReturnType<typeof getDocs>> = [];
        if (clientId) qrys.push(getDocs(query(maintenancesRef, where("clientId", "==", clientId))));
        if (firebaseUserEmail) {
          qrys.push(getDocs(query(maintenancesRef, where("clientContact.email", "==", firebaseUserEmail))));
          qrys.push(getDocs(query(maintenancesRef, where("signerEmail", "==", firebaseUserEmail))));
        }

        const snaps = qrys.length ? await Promise.all(qrys) : [];
        const map = new Map<string, MaintenanceDoc>();
        for (const s of snaps) {
          for (const d of s.docs) {
            map.set(d.id, { id: d.id, ...(d.data() as Omit<MaintenanceDoc, "id">) });
          }
        }
        const all = Array.from(map.values());

        function toMs(v: unknown): number {
          if (!v) return 0;
          // Firestore Timestamp (client)
          if (typeof v === "object" && v !== null && "toDate" in v && typeof (v as any).toDate === "function") {
            try {
              const d = (v as any).toDate() as Date;
              const ms = d.getTime();
              return Number.isFinite(ms) ? ms : 0;
            } catch {
              return 0;
            }
          }
          if (typeof v === "string" || typeof v === "number") {
            const ms = new Date(v).getTime();
            return Number.isFinite(ms) ? ms : 0;
          }
          return 0;
        }

        // Heuristique “active”: la plus récente parmi celles avec contrat/signature,
        // sinon la plus récente tout court. (Évite d'afficher une ancienne maintenance.)
        const score = (m: MaintenanceDoc): number => Math.max(toMs(m.updatedAt), toMs(m.createdAt));
        const candidates = all.filter((m) => !!m.contractNumber || !!m.yousignRequestId);
        const best = (candidates.length ? candidates : all).sort((a, b) => score(b) - score(a))[0] ?? null;

        if (!best) {
          if (!cancelled) {
            setMaintenance(null);
            setDocs([]);
          }
          return;
        }

        const docsSnap = await getDocs(collection(db, `maintenances/${best.id}/documents`));
        const docsList: MaintenanceUploadedDoc[] = docsSnap.docs.map((d) => ({
          id: d.id,
          maintenanceId: best.id,
          ...(d.data() as Omit<MaintenanceUploadedDoc, "id" | "maintenanceId">),
        }));

        if (!cancelled) {
          setMaintenance(best);
          setDocs(docsList);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Impossible de charger la maintenance.");
          setMaintenance(null);
          setDocs([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [clientId, firebaseUserEmail]);

  const docsSorted = useMemo(() => {
    return [...docs].sort((a, b) => {
      const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      return tb - ta;
    });
  }, [docs]);

  const effectiveSignature = liveSignature || maintenance?.signatureStatus;

  async function refreshStatuses() {
    if (!maintenance) return;
    setRefreshing(true);
    setError(null);
    try {
      // Signature (DocuSign/Yousign)
      if (maintenance.yousignRequestId) {
        const s = await getSignatureStatusFromBackend({ requestId: maintenance.yousignRequestId });
        setLiveSignature(s.status);
        setLiveSignedAt(s.signedAt ?? null);
      }

      // GoCardless subscription
      const subId = maintenance.gocardlessSubscriptionId || maintenance.subscriptionId;
      if (subId) {
        const gc = await getGoCardlessSubscriptionStatusFromBackend({ subscriptionId: subId });
        setGcStatus(gc.status);
        setGcNextChargeDate(gc.nextChargeDate ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de rafraîchir le statut.");
    } finally {
      setRefreshing(false);
    }
  }

  async function downloadSigned() {
    if (!maintenance?.yousignRequestId) return;
    setDownloading(true);
    setError(null);
    try {
      const filename = `Contrat_Signe_${maintenance.contractNumber || maintenance.yousignRequestId}.pdf`;
      await downloadSignedContractFromBackend({ requestId: maintenance.yousignRequestId, filename });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Téléchargement impossible.");
    } finally {
      setDownloading(false);
    }
  }

  async function sendWelcomeEmailManual() {
    if (!maintenance?.id) return;
    setSendingWelcome(true);
    setError(null);
    setWelcomeStatus(null);
    try {
      const url = `${GOCARDLESS_BACKEND_BASE_URL}/api/debug/send-welcome-email`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenanceId: maintenance.id }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || data?.details || `Erreur ${res.status}`);
      }
      setWelcomeStatus({
        ok: true,
        message: `Email de bienvenue envoyé à ${data?.toEmail || maintenance.signerEmail || maintenance.clientContact?.email || "—"}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Envoi email impossible.";
      setWelcomeStatus({ ok: false, message: msg });
      setError(msg);
    } finally {
      setSendingWelcome(false);
    }
  }

  if (loading) {
    return <div style={card}>Chargement de votre maintenance…</div>;
  }

  if (!maintenance) {
    return (
      <div style={card}>
        <h2 style={{ marginBottom: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--text)" }}>
          Dashboard maintenance
        </h2>
        <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.65 }}>
          Aucune maintenance active trouvée pour votre compte.
        </div>
      </div>
    );
  }

  const subId = maintenance.gocardlessSubscriptionId || maintenance.subscriptionId;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--text)" }}>
              Maintenance active
            </h2>
            <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              {maintenance.equipmentName || "Équipement"} {maintenance.contractNumber ? `· Contrat #${maintenance.contractNumber}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={refreshStatuses}
              disabled={refreshing}
              style={{
                padding: "10px 14px",
                borderRadius: 999,
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                cursor: refreshing ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14,
              }}
            >
              {refreshing ? "Rafraîchissement…" : "Rafraîchir le statut"}
            </button>
            <button
              type="button"
              onClick={sendWelcomeEmailManual}
              disabled={sendingWelcome}
              style={{
                padding: "10px 14px",
                borderRadius: 999,
                background: sendingWelcome ? "rgba(13,27,42,0.06)" : "rgba(0,184,220,0.10)",
                border: "1px solid rgba(0,184,220,0.22)",
                color: "var(--text)",
                cursor: sendingWelcome ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14,
                fontWeight: 700,
              }}
              title="Déclenche manuellement l’email de bienvenue (debug)"
            >
              {sendingWelcome ? "Envoi…" : "Tester email de bienvenue"}
            </button>
            <button
              type="button"
              onClick={downloadSigned}
              disabled={!maintenance.yousignRequestId || downloading}
              style={{
                padding: "10px 16px",
                borderRadius: 999,
                background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                border: "none",
                color: "#fff",
                cursor: !maintenance.yousignRequestId || downloading ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14,
                fontWeight: 600,
                opacity: !maintenance.yousignRequestId || downloading ? 0.7 : 1,
              }}
            >
              {downloading ? "Téléchargement…" : "Télécharger contrat signé"}
            </button>
          </div>
        </div>

        {welcomeStatus ? (
          <div style={{ marginTop: 12, color: welcomeStatus.ok ? "#067647" : "#b42318", fontSize: 13 }}>
            {welcomeStatus.message}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 14,
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg2)" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Contrat
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: "var(--text)" }}>
              {fmtYmd(maintenance.lastMaintenance)} → {fmtYmd(maintenance.nextMaintenance)}
            </div>
          </div>

          <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg2)" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Signature
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: "var(--text)" }}>
              {effectiveSignature === "signed"
                ? "Signé"
                : effectiveSignature === "declined"
                  ? "Refusé"
                  : effectiveSignature === "expired"
                    ? "Expiré"
                    : "En attente"}
            </div>
            {liveSignedAt ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                Signé le {new Date(liveSignedAt).toLocaleDateString("fr-FR")}
              </div>
            ) : maintenance.signatureDate ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                Signé le {fmtYmd(maintenance.signatureDate)}
              </div>
            ) : null}
          </div>

          <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg2)" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Prélèvement (GoCardless)
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: "var(--text)" }}>
              {gcStatus || maintenance.subscriptionStatus || (subId ? "—" : "Non configuré")}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
              {gcNextChargeDate
                ? `Prochaine facturation: ${fmtYmd(gcNextChargeDate)}`
                : maintenance.paymentDate
                  ? `Le ${maintenance.paymentDate} de chaque mois`
                  : "—"}
            </div>
          </div>
        </div>

        {error ? <div style={{ marginTop: 12, color: "#b42318", fontSize: 13 }}>{error}</div> : null}
      </section>

      <section style={card}>
        <h3 style={{ marginBottom: 12, fontFamily: "'DM Sans', sans-serif", fontSize: 16, color: "var(--text)" }}>
          Documents
        </h3>
        {docsSorted.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {docsSorted.map((d) => (
              <div
                key={d.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: 14,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 220 }}>
                  <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{d.name || "Document"}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
                    {d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString("fr-FR") : "—"} {d.size ? `· ${bytesToMb(d.size)}` : ""}
                  </div>
                </div>
                {d.url ? (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      padding: "8px 12px",
                      borderRadius: 999,
                      background: "var(--cyan-10)",
                      border: "1px solid var(--border-cyan)",
                      color: "var(--cyan)",
                      textDecoration: "none",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    Ouvrir
                  </a>
                ) : (
                  <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Indisponible</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>
            Aucun document disponible pour le moment.
          </div>
        )}
      </section>
    </div>
  );
}

