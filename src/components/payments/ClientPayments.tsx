import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import {
  getGoCardlessPaymentsBySubscriptionFromBackend,
  getGoCardlessSubscriptionStatusFromBackend,
  type GoCardlessPayment,
} from "../../lib/gocardless-backend";

type MaintenanceDoc = {
  id: string;
  clientId?: string;
  clientContact?: { email?: string };
  signerEmail?: string;
  equipmentName?: string;
  contractNumber?: string;
  paymentMethod?: "gocardless" | "manual";
  paymentDate?: number;
  monthlyAmount?: number;
  gocardlessSubscriptionId?: string;
  subscriptionId?: string;
  subscriptionStatus?: string;
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 22,
  boxShadow: "var(--shadow-sm)",
};

const kpiCard: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 16,
  boxShadow: "var(--shadow-sm)",
};

function fmtYmd(ymd?: string | null): string {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("fr-FR");
}

function fmtShortDate(ymd?: string | null): string {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function fmtAmount(amount?: number, currency?: string): string {
  if (typeof amount !== "number") return "—";
  // GoCardless amounts are typically in pence/cents; but repo mixes formats. We display as-is if looks like euros.
  const looksLikeCents = amount > 1000;
  const euros = looksLikeCents ? amount / 100 : amount;
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency || "EUR" }).format(euros);
}

function daysUntil(ymd?: string | null): number | null {
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = d.getTime() - startOfToday.getTime();
  return Math.round(diff / (24 * 60 * 60 * 1000));
}

function computeNextMonthlyChargeDate(paymentDayOfMonth?: number | null): string | null {
  // Fallback: certains retours GoCardless (sandbox/abonnements) ne fournissent pas next_charge_date.
  // Ici, on calcule la prochaine échéance mensuelle à partir du jour du mois (souvent 1..28).
  if (typeof paymentDayOfMonth !== "number") return null;

  const dom = Math.max(1, Math.min(28, Math.round(paymentDayOfMonth)));
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let target = new Date(now.getFullYear(), now.getMonth(), dom);
  if (target.getTime() < startOfToday.getTime()) {
    target = new Date(now.getFullYear(), now.getMonth() + 1, dom);
  }

  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, "0");
  const d = String(target.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function downloadTextFile(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toCsvValue(v: unknown): string {
  const s = v == null ? "" : String(v);
  const escaped = s.replaceAll('"', '""');
  return `"${escaped}"`;
}

export function ClientPayments({
  clientId,
  firebaseUserEmail,
}: {
  clientId: string | null;
  firebaseUserEmail: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [maintenance, setMaintenance] = useState<MaintenanceDoc | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<{ status: string; nextChargeDate?: string | null } | null>(
    null
  );
  const [payments, setPayments] = useState<GoCardlessPayment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!clientId && !firebaseUserEmail) {
        setLoading(false);
        setMaintenance(null);
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
        for (const s of snaps) for (const d of s.docs) map.set(d.id, { id: d.id, ...(d.data() as any) });
        const all = Array.from(map.values());
        const best = all.find((m) => !!m.contractNumber || !!m.subscriptionId || !!m.gocardlessSubscriptionId) ?? all[0] ?? null;
        if (!cancelled) setMaintenance(best);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Impossible de charger vos paiements.");
          setMaintenance(null);
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

  const subscriptionId = maintenance?.gocardlessSubscriptionId || maintenance?.subscriptionId || null;

  async function refresh() {
    if (!subscriptionId) return;
    setRefreshing(true);
    setError(null);
    try {
      const [sub, pay] = await Promise.all([
        getGoCardlessSubscriptionStatusFromBackend({ subscriptionId }),
        getGoCardlessPaymentsBySubscriptionFromBackend({ subscriptionId, limit: 30 }),
      ]);
      setSubscriptionStatus(sub);
      setPayments(pay.payments || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de rafraîchir les paiements.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!subscriptionId) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionId]);

  const paymentsSorted = useMemo(() => {
    return [...payments].sort((a, b) => {
      const da = a.charge_date ? new Date(a.charge_date).getTime() : a.created_at ? new Date(a.created_at).getTime() : 0;
      const dbb = b.charge_date ? new Date(b.charge_date).getTime() : b.created_at ? new Date(b.created_at).getTime() : 0;
      return dbb - da;
    });
  }, [payments]);

  const nextChargeDate =
    subscriptionStatus?.nextChargeDate ??
    (typeof maintenance.paymentDate === "number" ? computeNextMonthlyChargeDate(maintenance.paymentDate) : null);
  const nextChargeInDays = useMemo(() => daysUntil(nextChargeDate), [nextChargeDate]);

  function exportCsv() {
    const rows = paymentsSorted.map((p) => ({
      id: p.id,
      status: p.status ?? "",
      amount: p.amount ?? "",
      currency: p.currency ?? "",
      charge_date: p.charge_date ?? "",
      created_at: p.created_at ?? "",
      description: p.description ?? "",
      subscription: p.links?.subscription ?? "",
      mandate: p.links?.mandate ?? "",
    }));

    const headers = Object.keys(rows[0] ?? {
      id: "",
      status: "",
      amount: "",
      currency: "",
      charge_date: "",
      created_at: "",
      description: "",
      subscription: "",
      mandate: "",
    });
    const csv =
      headers.map(toCsvValue).join(",") +
      "\n" +
      rows.map((r) => headers.map((h) => toCsvValue((r as Record<string, unknown>)[h])).join(",")).join("\n");

    const ymd = new Date().toISOString().slice(0, 10);
    downloadTextFile(`paiements-${ymd}.csv`, csv, "text/csv;charset=utf-8");
  }

  if (loading) return <div style={card}>Chargement…</div>;

  if (!maintenance) {
    return (
      <div style={card}>
        <h2 style={{ marginBottom: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--text)" }}>
          Paiements
        </h2>
        <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.65 }}>
          Aucune maintenance active trouvée pour votre compte.
        </div>
      </div>
    );
  }

  if (maintenance.paymentMethod !== "gocardless") {
    return (
      <div style={card}>
        <h2 style={{ marginBottom: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--text)" }}>
          Paiements
        </h2>
        <div style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.65 }}>
          Mode de paiement: {maintenance.paymentMethod || "—"}.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* KPI */}
      <section
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}
      >
        <div style={kpiCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                Mont. mensu.
              </div>
              <div style={{ marginTop: 8, fontFamily: "'DM Sans', sans-serif", fontSize: 24, fontWeight: 900, color: "var(--text)", letterSpacing: "-0.03em" }}>
                {typeof maintenance.monthlyAmount === "number" ? fmtAmount(maintenance.monthlyAmount, "EUR") : "—"}
              </div>
              <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>
                {maintenance.paymentDate ? `Prélevé le ${maintenance.paymentDate} du mois` : "—"}
              </div>
            </div>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                background: "var(--cyan-10)",
                border: "1px solid var(--border-cyan)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--cyan)",
              }}
              aria-hidden="true"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 3v18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M3 12h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>

        <div style={kpiCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                Proc. échéa.
              </div>
              <div style={{ marginTop: 8, fontFamily: "'DM Sans', sans-serif", fontSize: 24, fontWeight: 900, color: "var(--text)", letterSpacing: "-0.03em" }}>
                {nextChargeDate ? fmtShortDate(nextChargeDate) : "—"}
              </div>
              <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>
                {typeof nextChargeInDays === "number" ? (nextChargeInDays >= 0 ? `Dans ${nextChargeInDays} jours` : `Il y a ${Math.abs(nextChargeInDays)} jours`) : "—"}
              </div>
            </div>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                background: "var(--cyan-10)",
                border: "1px solid var(--border-cyan)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--cyan)",
              }}
              aria-hidden="true"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M7 3v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M17 3v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M4 8h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M6 21h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
          </div>
        </div>

        <div style={kpiCard}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                Statut abon.
              </div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background:
                      (subscriptionStatus?.status || maintenance.subscriptionStatus || "").toLowerCase() === "active"
                        ? "#22C55E"
                        : "var(--cyan)",
                    boxShadow:
                      (subscriptionStatus?.status || maintenance.subscriptionStatus || "").toLowerCase() === "active"
                        ? "0 0 0 4px rgba(34,197,94,0.16)"
                        : "0 0 0 4px rgba(0,184,220,0.14)",
                  }}
                  aria-hidden="true"
                />
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 22, fontWeight: 900, color: "var(--text)", letterSpacing: "-0.03em" }}>
                  {(subscriptionStatus?.status || maintenance.subscriptionStatus || (subscriptionId ? "—" : "Non configuré")) as string}
                </div>
              </div>
              <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>GoCardless · SEPA</div>
            </div>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                background: "var(--cyan-10)",
                border: "1px solid var(--border-cyan)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--cyan)",
              }}
              aria-hidden="true"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M12 20a8 8 0 1 0-8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 4a8 8 0 0 1 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M8 12l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--text)" }}>
              Abonnement (GoCardless)
            </h2>
            <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              {maintenance.equipmentName || "Équipement"} {maintenance.contractNumber ? `· Contrat #${maintenance.contractNumber}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={!subscriptionId || refreshing}
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              background: "var(--bg2)",
              border: "1px solid var(--border)",
              cursor: !subscriptionId || refreshing ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14,
              opacity: !subscriptionId || refreshing ? 0.7 : 1,
            }}
          >
            {refreshing ? "Rafraîchissement…" : "Rafraîchir"}
          </button>
        </div>

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
              Statut
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: "var(--text)" }}>
              {subscriptionStatus?.status || maintenance.subscriptionStatus || (subscriptionId ? "—" : "Non configuré")}
            </div>
          </div>

          <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg2)" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Prochaine facturation
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: "var(--text)" }}>
              {subscriptionStatus?.nextChargeDate ? fmtYmd(subscriptionStatus.nextChargeDate) : maintenance.paymentDate ? `Le ${maintenance.paymentDate} de chaque mois` : "—"}
            </div>
          </div>

          <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg2)" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Montant mensuel
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: "var(--text)" }}>
              {typeof maintenance.monthlyAmount === "number" ? fmtAmount(maintenance.monthlyAmount, "EUR") : "—"}
            </div>
          </div>
        </div>

        {error ? <div style={{ marginTop: 12, color: "#b42318", fontSize: 13 }}>{error}</div> : null}
      </section>

      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 16, color: "var(--text)" }}>Historique des paiements</h3>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!paymentsSorted.length}
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              background: "#fff",
              border: "1px solid var(--border)",
              cursor: paymentsSorted.length ? "pointer" : "not-allowed",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14,
              fontWeight: 700,
              opacity: paymentsSorted.length ? 1 : 0.6,
            }}
          >
            Exporter CSV
          </button>
        </div>
        {paymentsSorted.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {paymentsSorted.map((p) => (
              <div
                key={p.id}
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
                    {p.status || "Paiement"} {p.amount != null ? `· ${fmtAmount(p.amount, p.currency)}` : ""}
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
                    {p.charge_date ? `Prélevé le ${fmtYmd(p.charge_date)}` : p.created_at ? `Créé le ${fmtYmd(p.created_at.slice(0, 10))}` : "—"}
                  </div>
                  {p.description ? (
                    <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                      {p.description}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              padding: "28px 16px",
              border: "1px dashed rgba(0,0,0,0.12)",
              borderRadius: "var(--radius-sm)",
              background: "rgba(255,255,255,0.6)",
              display: "grid",
              placeItems: "center",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                marginBottom: 10,
              }}
              aria-hidden="true"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M7 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M7 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
            <div style={{ fontWeight: 800, color: "var(--text)", fontSize: 14 }}>Aucun paiement trouvé</div>
            <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5, maxWidth: 360 }}>
              Votre historique apparaîtra ici après le premier prélèvement.
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

