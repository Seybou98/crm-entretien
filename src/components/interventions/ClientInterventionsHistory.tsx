import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  type QuerySnapshot,
  type DocumentData,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { getGoCardlessSubscriptionStatusFromBackend, getSignatureStatusFromBackend } from "../../lib/gocardless-backend";

type MaintenanceDoc = {
  id: string;
  clientId?: string;
  clientName?: string;
  clientContact?: { email?: string };
  signerEmail?: string;
  status?: string;
  equipmentName?: string;
  contractNumber?: string;
  yousignRequestId?: string;
  signatureStatus?: "pending" | "signed" | "declined" | "expired";
  signatureDate?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  gocardlessSubscriptionId?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
};

type MaintenanceHistoryEntry = {
  id: string;
  type?: string;
  label?: string;
  userName?: string;
  createdAt?: string;
  metadata?: Record<string, unknown> | null;
};

type InterventionRecord = {
  id: string;
  date?: string;
  time?: string;
  duration?: string;
  team?: string;
  type?: string;
  status?: string;
  notes?: string;
  location?: string;
  createdAt?: string;
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 22,
  boxShadow: "var(--shadow-sm)",
};

function fmtIso(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function fmtDateOnly(ymd?: string | null): string {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("fr-FR");
}

function statusLabel(status?: string): string {
  const s = (status || "").toLowerCase();
  switch (s) {
    case "aprogrammer":
      return "À programmer";
    case "programme":
      return "Programmé";
    case "terminer":
      return "Terminé";
    case "adecaler":
      return "À décaler";
    case "annuler":
      return "Annulé";
    default:
      return status || "—";
  }
}

function typeLabel(type?: string): string {
  const t = (type || "").toLowerCase();
  if (t === "maintenance") return "Maintenance";
  if (t === "sav") return "SAV";
  if (t === "installation") return "Installation";
  return type || "Intervention";
}

async function safeGetDocs(p: Promise<QuerySnapshot<DocumentData>>): Promise<QuerySnapshot<DocumentData> | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export function ClientInterventionsHistory({
  clientId,
  firebaseUserEmail,
}: {
  clientId: string | null;
  firebaseUserEmail: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [maintenance, setMaintenance] = useState<MaintenanceDoc | null>(null);
  const [historyEntries, setHistoryEntries] = useState<MaintenanceHistoryEntry[]>([]);
  const [interventions, setInterventions] = useState<InterventionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [liveSignature, setLiveSignature] = useState<MaintenanceDoc["signatureStatus"]>();
  const [liveSignedAt, setLiveSignedAt] = useState<string | null>();
  const [gcStatus, setGcStatus] = useState<string | null>(null);
  const [gcNextChargeDate, setGcNextChargeDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadMaintenance() {
      if (!clientId && !firebaseUserEmail) {
        setLoading(false);
        setMaintenance(null);
        setHistoryEntries([]);
        setInterventions([]);
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
        const best = all.find((m) => !!m.contractNumber || !!m.yousignRequestId) ?? all[0] ?? null;

        if (!cancelled) setMaintenance(best);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Impossible de charger la maintenance.");
          setMaintenance(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadMaintenance();
    return () => {
      cancelled = true;
    };
  }, [clientId, firebaseUserEmail]);

  // A) Timeline depuis maintenances/{id}/history (si disponible)
  useEffect(() => {
    if (!maintenance?.id) {
      setHistoryEntries([]);
      return;
    }
    const ref = collection(db, "maintenances", maintenance.id, "history");
    const q = query(ref, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const entries: MaintenanceHistoryEntry[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setHistoryEntries(entries);
      },
      () => {
        // Silent: rules may restrict access; we keep a best-effort timeline.
        setHistoryEntries([]);
      }
    );
    return () => unsub();
  }, [maintenance?.id]);

  // B) Interventions: collections CRM existantes (appointments + installations)
  useEffect(() => {
    let cancelled = false;
    async function loadInterventions() {
      if (!clientId) {
        setInterventions([]);
        return;
      }

      // Appointments (realtime in CRM) + Installations (one-shot)
      const apptQ = query(collection(db, "appointments"), where("client.id", "==", clientId));
      const instQ = query(collection(db, "installations"), where("client.id", "==", clientId));

      const [apptSnap, instSnap] = await Promise.all([safeGetDocs(getDocs(apptQ)), safeGetDocs(getDocs(instQ))]);
      const appts = apptSnap ? (apptSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as InterventionRecord[]) : [];
      const insts = instSnap ? (instSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as InterventionRecord[]) : [];

      const merged = [...appts, ...insts]
        .filter(Boolean)
        .sort((a, b) => {
          const da = a.date ? new Date(a.date).getTime() : 0;
          const dbb = b.date ? new Date(b.date).getTime() : 0;
          return dbb - da;
        })
        .slice(0, 20);

      if (!cancelled) setInterventions(merged);
    }

    void loadInterventions();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const effectiveSignature = liveSignature || maintenance?.signatureStatus;

  async function refreshLive() {
    if (!maintenance) return;
    setError(null);
    try {
      if (maintenance.yousignRequestId) {
        const s = await getSignatureStatusFromBackend({ requestId: maintenance.yousignRequestId });
        setLiveSignature(s.status);
        setLiveSignedAt(s.signedAt ?? null);
      }
      const subId = maintenance.gocardlessSubscriptionId || maintenance.subscriptionId;
      if (subId) {
        const gc = await getGoCardlessSubscriptionStatusFromBackend({ subscriptionId: subId });
        setGcStatus(gc.status);
        setGcNextChargeDate(gc.nextChargeDate ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de rafraîchir.");
    }
  }

  const timeline = useMemo(() => {
    const items: Array<{ id: string; title: string; subtitle?: string; at?: string }> = [];

    // Best-effort base items
    if (maintenance?.contractNumber) {
      items.push({
        id: "contract_created",
        title: `Contrat créé (#${maintenance.contractNumber})`,
        subtitle: maintenance.equipmentName ? `${maintenance.equipmentName}` : undefined,
      });
    }

    if (maintenance?.status) {
      items.push({ id: "status_now", title: `Statut actuel: ${statusLabel(maintenance.status)}` });
    }

    if (effectiveSignature) {
      items.push({
        id: "signature_now",
        title: `Signature: ${
          effectiveSignature === "signed"
            ? "Signé"
            : effectiveSignature === "declined"
              ? "Refusé"
              : effectiveSignature === "expired"
                ? "Expiré"
                : "En attente"
        }`,
        subtitle: liveSignedAt ? `Signé le ${fmtIso(liveSignedAt)}` : maintenance?.signatureDate ? `Signé le ${fmtDateOnly(maintenance.signatureDate)}` : undefined,
      });
    }

    const subLabel = gcStatus || maintenance?.subscriptionStatus;
    if (subLabel) {
      items.push({
        id: "subscription_now",
        title: `Abonnement: ${subLabel}`,
        subtitle: gcNextChargeDate ? `Prochaine facturation: ${fmtDateOnly(gcNextChargeDate)}` : undefined,
      });
    }

    // Real history entries (if accessible)
    for (const e of historyEntries) {
      const title = e.label?.trim() || (e.type ? `Événement: ${e.type}` : "Événement");
      items.push({
        id: `history_${e.id}`,
        title,
        subtitle: e.userName ? `Par ${e.userName}` : undefined,
        at: e.createdAt,
      });
    }

    // De-dupe by id (best effort)
    const uniq = new Map<string, (typeof items)[number]>();
    for (const it of items) uniq.set(it.id, it);
    return Array.from(uniq.values());
  }, [maintenance, effectiveSignature, liveSignedAt, gcStatus, gcNextChargeDate, historyEntries]);

  if (loading) {
    return <div style={card}>Chargement…</div>;
  }

  if (!maintenance) {
    return (
      <div style={card}>
        <h2 style={{ marginBottom: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--text)" }}>
          Interventions & historique
        </h2>
        <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.65 }}>
          Aucune maintenance active trouvée pour votre compte.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--text)" }}>
              Interventions
            </h2>
            <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              {maintenance.equipmentName || "Équipement"} {maintenance.contractNumber ? `· Contrat #${maintenance.contractNumber}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={refreshLive}
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              background: "var(--bg2)",
              border: "1px solid var(--border)",
              cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14,
            }}
          >
            Rafraîchir
          </button>
        </div>

        {error ? <div style={{ marginTop: 12, color: "#b42318", fontSize: 13 }}>{error}</div> : null}

        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
          {interventions.length ? (
            interventions.map((i) => (
              <div
                key={i.id}
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
                  <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 14 }}>
                    {typeLabel(i.type)} {i.status ? `· ${statusLabel(i.status)}` : ""}
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
                    {i.date ? fmtDateOnly(i.date) : "—"} {i.time ? `· ${i.time}` : ""} {i.team ? `· ${i.team}` : ""}
                  </div>
                  {i.location ? (
                    <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>{i.location}</div>
                  ) : null}
                  {i.notes ? (
                    <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                      {i.notes}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6 }}>
              Aucune intervention enregistrée pour le moment.
            </div>
          )}
        </div>
      </section>

      <section style={card}>
        <h3 style={{ marginBottom: 12, fontFamily: "'DM Sans', sans-serif", fontSize: 16, color: "var(--text)" }}>
          Historique
        </h3>
        <div style={{ display: "grid", gap: 10 }}>
          {timeline.map((t) => (
            <div
              key={t.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: 14,
                background: "var(--bg2)",
              }}
            >
              <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 14 }}>{t.title}</div>
              {t.subtitle ? (
                <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.5 }}>
                  {t.subtitle}
                </div>
              ) : null}
              {t.at ? (
                <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 12 }}>
                  {fmtIso(t.at)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

