import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import { onAuthStateChanged, signOut, type User as FirebaseUser } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "../../lib/firebase";
import EntretienPage, { GlobalStyles } from "../../entretien";
import { SiteHeader } from "../components/SiteHeader";
import { PublicChatbotWidget } from "../chatbot/PublicChatbotWidget";
import { ClientContractsDocuments } from "../components/contracts/ClientContractsDocuments";
import { ClientMaintenanceDashboard } from "../components/maintenance/ClientMaintenanceDashboard";
import { ClientInterventionsHistory } from "../components/interventions/ClientInterventionsHistory";
import { ClientPayments } from "../components/payments/ClientPayments";
import {
  CLIENT_PORTAL_SECTIONS,
  getClientPortalSectionCopy,
  type ClientPortalSectionId,
} from "./clientPortalSections";

type CRMClient = {
  name?: string;
  contact?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
  address?: {
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  };
};

const PORTAL_USERS_COL = "client_portal_users";
const CRM_CLIENTS_COL = "clients";
const CLIENT_ENTRETIEN_COL = "client_entretien";

function formatClientName(client: CRMClient | null) {
  if (!client) return "Votre profil";
  const first = client.contact?.firstName?.trim();
  const last = client.contact?.lastName?.trim();
  if (first || last) return [first, last].filter(Boolean).join(" ");
  return client.name?.trim() || "Votre profil";
}

function formatAddress(client: CRMClient | null): string {
  if (!client?.address) return "-";
  const { street, postalCode, city } = client.address;
  const parts = [street?.trim(), [postalCode, city].filter(Boolean).join(" ").trim()].filter(Boolean);
  return parts.length ? parts.join(", ") : "-";
}

function labelInitials(source: string): string {
  const t = source.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[parts.length - 1][0];
    if (a && b) return (a + b).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

const mainShell: CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg2)",
  padding: "calc(var(--header-h) + 24px) var(--container-px) 48px",
  fontFamily: "'DM Sans', sans-serif"
};

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 22,
  boxShadow: "var(--shadow-sm)"
};

function ComingSoonPanel({ title }: { title: string }) {
  return (
    <div style={card}>
      <h2
        style={{
          marginBottom: 10,
          fontFamily: "'DM Sans', sans-serif",
          fontSize: 18,
          color: "var(--text)"
        }}
      >
        {title}
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.65, marginBottom: 16 }}>
        Cette section est en cours de préparation. Vous y retrouverez bientôt vos données et actions liées à ce
        thème.
      </p>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 999,
          background: "var(--cyan-10)",
          border: "1px solid var(--border-cyan)",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--cyan)",
          letterSpacing: "0.04em",
          textTransform: "uppercase"
        }}
      >
        Bientôt disponible
      </div>
    </div>
  );
}

export function ClientPortalPrivate() {
  const location = useLocation();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [client, setClient] = useState<CRMClient | null>(null);
  const [portalClientId, setPortalClientId] = useState<string | null>(null);
  const [loadingClient, setLoadingClient] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sectionFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const candidate = params.get("section");
    if (!candidate) return null;
    const allowed = CLIENT_PORTAL_SECTIONS.some((s) => s.id === candidate);
    if (!allowed) return null;
    return candidate as ClientPortalSectionId;
  }, [location.search]);

  const [activeSection, setActiveSection] = useState<ClientPortalSectionId>(sectionFromUrl ?? "informations");

  useEffect(() => {
    if (sectionFromUrl) setActiveSection(sectionFromUrl);
  }, [sectionFromUrl]);
  const [contractBadge, setContractBadge] = useState<{ label: string; tone: "ok" | "pending" | "muted" }>({
    label: "Contrat actif",
    tone: "muted",
  });
  const [activeContractRef, setActiveContractRef] = useState<{ equipmentName?: string; contractNumber?: string } | null>(
    null
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadClient(u: FirebaseUser) {
      setLoadingClient(true);
      setError(null);

      try {
        const portalUserSnap = await getDoc(doc(db, PORTAL_USERS_COL, u.uid));
        if (!portalUserSnap.exists()) {
          throw new Error("Aucun compte portail associé à votre identifiant.");
        }

        const portalUserData = portalUserSnap.data() as { clientId?: string; clientSource?: "clients" | "client_entretien"; email?: string };
        const clientId = portalUserData.clientId;
        if (!clientId) {
          throw new Error("Votre compte portail n'est pas lié à un client CRM.");
        }
        if (!cancelled) setPortalClientId(clientId);

        const source = portalUserData.clientSource ?? "clients";
        const col = source === "client_entretien" ? CLIENT_ENTRETIEN_COL : CRM_CLIENTS_COL;
        const clientSnap = await getDoc(doc(db, col, clientId));
        if (!clientSnap.exists()) throw new Error("Profil client introuvable.");

        if (!cancelled) {
          setClient(clientSnap.data() as CRMClient);
        }
      } catch (e) {
        if (!cancelled) {
          setClient(null);
          setPortalClientId(null);
          setError(e instanceof Error ? e.message : "Erreur de chargement du portail.");
        }
      } finally {
        if (!cancelled) setLoadingClient(false);
      }
    }

    if (!firebaseUser) {
      setClient(null);
      setPortalClientId(null);
      setLoadingClient(false);
      setError(null);
      return;
    }

    void loadClient(firebaseUser);
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  // Sidebar: statut contrat (best-effort) pour affichage permanent
  useEffect(() => {
    let cancelled = false;
    async function loadContractBadge() {
      if (!portalClientId && !firebaseUser?.email) {
        setContractBadge({ label: "Contrat", tone: "muted" });
        setActiveContractRef(null);
        return;
      }
      try {
        // On lit d'abord les maintenances (source la plus cohérente avec portail)
        const maintenancesRef = collection(db, "maintenances");
        const qrys: Array<ReturnType<typeof getDocs>> = [];
        if (portalClientId) qrys.push(getDocs(query(maintenancesRef, where("clientId", "==", portalClientId))));
        if (firebaseUser?.email) {
          qrys.push(getDocs(query(maintenancesRef, where("clientContact.email", "==", firebaseUser.email))));
          qrys.push(getDocs(query(maintenancesRef, where("signerEmail", "==", firebaseUser.email))));
        }
        const snaps = qrys.length ? await Promise.all(qrys) : [];
        const all = snaps.flatMap((s) => s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        const best =
          all.find((m) => !!m.contractNumber || !!m.yousignRequestId) ??
          all[0] ??
          null;

        if (!best) {
          if (!cancelled) {
            setContractBadge({ label: "Aucun contrat", tone: "muted" });
            setActiveContractRef(null);
          }
          return;
        }

        const sig = String(best.signatureStatus || "").toLowerCase();
        const tone = sig === "signed" ? "ok" : sig ? "pending" : "muted";
        const label = sig === "signed" ? "Contrat actif" : sig === "pending" ? "Signature en attente" : "Contrat actif";

        if (!cancelled) {
          setContractBadge({ label, tone });
          setActiveContractRef({
            equipmentName: best.equipmentName,
            contractNumber: best.contractNumber,
          });
        }
      } catch {
        if (!cancelled) {
          setContractBadge({ label: "Contrat actif", tone: "muted" });
          setActiveContractRef(null);
        }
      }
    }

    void loadContractBadge();
    return () => {
      cancelled = true;
    };
  }, [portalClientId, firebaseUser?.email]);

  const displayName = useMemo(() => formatClientName(client), [client]);
  const addressLine = useMemo(() => formatAddress(client), [client]);
  const profileEmail = useMemo(
    () => client?.contact?.email?.trim() || firebaseUser?.email || "",
    [client, firebaseUser]
  );
  const activeSectionCopy = useMemo(() => getClientPortalSectionCopy(activeSection), [activeSection]);

  if (!firebaseUser) {
    return <EntretienPage />;
  }

  return (
    <>
      <GlobalStyles />
      <style>{`
        /* Portal layout tweaks (responsive + full width) */
        .portal-shell { width: 100%; }
        .portal-card { max-width: 100%; }
        .portal-email { word-break: break-word; overflow-wrap: anywhere; }
        .portal-layout { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
        .portal-nav { flex: 0 1 300px; min-width: min(100%, 260px); }
        .portal-main { flex: 1 1 360px; min-width: 0; width: 100%; }
        .portal-sidebar { display:flex; flex-direction:column; gap: 12px; }
        .portal-sidebarInner { display:flex; flex-direction:column; gap: 10px; min-height: calc(100vh - var(--header-h) - 72px); }
        .portal-sticky { position: sticky; top: calc(var(--header-h) + 18px); }
        .portal-profileCard { padding: 16px !important; }
        .portal-helpCard { margin-top: auto; padding: 14px !important; background: linear-gradient(180deg, rgba(0,184,220,0.08), rgba(0,201,167,0.06)); border: 1px solid rgba(0,184,220,0.18); }
        .portal-avatar { width: 44px; height: 44px; border-radius: 999px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:14px; letter-spacing:0.02em; background: linear-gradient(135deg,var(--cyan),var(--teal)); border: 2px solid var(--border-cyan); box-shadow: 0 10px 22px rgba(0,184,220,0.14); }
        .portal-badge { display:inline-flex; align-items:center; gap: 8px; padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid var(--border); background: var(--bg2); color: var(--text-secondary); }
        .portal-dot { width:8px; height:8px; border-radius: 999px; background: #9CA3AF; }
        .portal-dot.ok { background: #22C55E; box-shadow: 0 0 0 4px rgba(34,197,94,0.15); }
        .portal-dot.pending { background: var(--cyan); box-shadow: 0 0 0 4px rgba(0,184,220,0.14); }
        .portal-mobileDisconnect { display:none; }
        .portal-mobileSections { display:none; }
        .portal-desktopSections { display:block; }
        .portal-desktopDisconnect { display:flex; gap: 10; flex-wrap: wrap; margin-top: 16px; }
        .portal-helpCardMobile { display:none; }
        .portal-pageHeader { margin-bottom: 14px; }
        .portal-h1 { font-family:'DM Sans', sans-serif; font-weight:800; letter-spacing:-0.03em; font-size: clamp(20px, 2.2vw, 28px); line-height:1.15; color: var(--text); }
        .portal-sub { margin-top: 6px; font-size: 14px; color: var(--text-muted); line-height: 1.55; max-width: 72ch; }

        @media (max-width: 820px) {
          .portal-layout { gap: 16px; }
          .portal-nav { flex: 1 1 100%; min-width: 0; }
          .portal-card { padding: 16px !important; }
          .portal-sticky { position: static; top: auto; }
          .portal-sidebarInner { min-height: unset; }
          .portal-mobileDisconnect { display:block; margin-top: 12px; }
          .portal-mobileSections { display:none; }
          .portal-desktopSections { display:none; }
          .portal-desktopDisconnect { display:none; }
          .portal-helpCardSidebar { display:none; }
          .portal-helpCardMobile { display:block; width:100%; }
        }
      `}</style>
      <SiteHeader
        user={firebaseUser}
        profileDisplayName={displayName}
        onOpenLoginModal={() => {}}
        onSignOut={() => signOut(auth)}
      />

      {loadingClient ? (
        <div style={mainShell}>
          <p style={{ color: "var(--text-secondary)", fontSize: 15 }}>Chargement de votre portail…</p>
        </div>
      ) : error ? (
        <div style={mainShell}>
          <div className="portal-card" style={{ ...card, maxWidth: 520 }}>
            <h1 style={{ marginBottom: 8, fontFamily: "'DM Sans', sans-serif", fontSize: 22 }}>Erreur</h1>
            <p style={{ marginBottom: 16, color: "var(--text-secondary)", fontSize: 14 }}>{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "10px 18px",
                borderRadius: 999,
                background: "var(--cyan)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14
              }}
            >
              Réessayer
            </button>
          </div>
        </div>
      ) : (
        <div className="portal-shell" style={mainShell}>
          <div
            className="portal-layout"
          >
            <nav
              aria-label="Sections portail"
              className="portal-nav portal-sticky"
              style={{ background: "transparent", border: "none", boxShadow: "none", padding: 0 }}
            >
              <div className="portal-sidebar portal-sidebarInner">
                <div className="portal-card portal-profileCard" style={card}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div className="portal-avatar" aria-hidden="true">
                      {labelInitials(displayName)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: 16,
                          fontWeight: 800,
                          color: "var(--text)",
                          letterSpacing: "-0.02em",
                          lineHeight: 1.2,
                        }}
                      >
                        {displayName}
                      </div>
                      <div className="portal-email" style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 13 }}>
                        {profileEmail || "—"}
                      </div>

                      {/* Mobile: mon espace doit apparaître sous l'email, avant Déconnexion */}
                      <div className="portal-mobileSections" style={{ marginTop: 12 }}>
                        <p
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            color: "var(--text-muted)",
                            padding: "0 0 8px",
                            margin: 0,
                          }}
                        >
                          Mon espace
                        </p>
                        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                          {CLIENT_PORTAL_SECTIONS.map((s) => {
                            const active = activeSection === s.id;
                            return (
                              <li key={s.id}>
                                <button
                                  type="button"
                                  onClick={() => setActiveSection(s.id)}
                                  style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "10px 14px",
                                    marginBottom: 4,
                                    borderRadius: "var(--radius-sm)",
                                    border: "none",
                                    cursor: "pointer",
                                    fontFamily: "'DM Sans', sans-serif",
                                    fontSize: 14,
                                    fontWeight: active ? 700 : 500,
                                    color: active ? "var(--text)" : "var(--text-secondary)",
                                    background: active ? "rgba(0,184,220,0.10)" : "transparent",
                                    boxShadow: active ? "0 10px 24px rgba(0,184,220,0.10)" : "none",
                                    transition: "background .15s, color .15s, box-shadow .15s",
                                  }}
                                >
                                  <span style={{ display: "block" }}>{s.label}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>

                      <div style={{ marginTop: 10 }}>
                        <span className="portal-badge">
                          <span className={`portal-dot ${contractBadge.tone}`} />
                          {contractBadge.label}
                        </span>
                      </div>
                      {activeContractRef?.equipmentName || activeContractRef?.contractNumber ? (
                        <div style={{ marginTop: 10, color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.5 }}>
                          {activeContractRef?.equipmentName ? <div>{activeContractRef.equipmentName}</div> : null}
                          {activeContractRef?.contractNumber ? (
                            <div style={{ color: "var(--text-muted)" }}>#{activeContractRef.contractNumber}</div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="portal-mobileDisconnect">
                        <button
                          type="button"
                          onClick={() => signOut(auth)}
                          style={{
                            padding: "10px 16px",
                            borderRadius: 999,
                            background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                            color: "#fff",
                            border: "none",
                            cursor: "pointer",
                            fontFamily: "'DM Sans', sans-serif",
                            fontSize: 14,
                            fontWeight: 700,
                            width: "100%",
                          }}
                        >
                          Déconnexion
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="portal-card portal-desktopSections" style={{ ...card, padding: 12 }}>
                  <p
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                      padding: "8px 12px 10px",
                    }}
                  >
                    Mon espace
                  </p>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {CLIENT_PORTAL_SECTIONS.map((s) => {
                      const active = activeSection === s.id;
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => setActiveSection(s.id)}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "12px 14px",
                              marginBottom: 4,
                              borderRadius: "var(--radius-sm)",
                              border: "none",
                              cursor: "pointer",
                              fontFamily: "'DM Sans', sans-serif",
                              fontSize: 14,
                              fontWeight: active ? 700 : 500,
                              color: active ? "var(--text)" : "var(--text-secondary)",
                              background: active ? "rgba(0,184,220,0.10)" : "transparent",
                              boxShadow: active ? "0 10px 24px rgba(0,184,220,0.10)" : "none",
                              transition: "background .15s, color .15s, box-shadow .15s",
                            }}
                          >
                            <span style={{ display: "block" }}>{s.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="portal-card portal-helpCard portal-helpCardSidebar" style={card}>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 800, color: "var(--text)" }}>
                    Besoin d’aide ?
                  </div>
                  <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.55 }}>
                    Notre équipe est disponible 7j/7. Décris ton besoin, on te répond rapidement.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const subject = encodeURIComponent("Aide — Portail client");
                      const body = encodeURIComponent(
                        `Bonjour,\n\nJ'ai besoin d'aide concernant mon portail client.\n\nNom: ${displayName}\nEmail: ${profileEmail}\n\nMessage:\n`
                      );
                      window.location.href = `mailto:contact@labelenergie.fr?subject=${subject}&body=${body}`;
                    }}
                    style={{
                      marginTop: 12,
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 999,
                      background: "#fff",
                      border: "1px solid rgba(0,184,220,0.24)",
                      cursor: "pointer",
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 14,
                      fontWeight: 700,
                      color: "var(--text)",
                    }}
                  >
                    Nous contacter
                  </button>
                </div>
              </div>
            </nav>

            <div className="portal-main">
              <div className="portal-pageHeader">
                <div className="portal-h1">{activeSectionCopy.title}</div>
                <div className="portal-sub">{activeSectionCopy.description}</div>
              </div>
              {activeSection === "informations" ? (
                <section className="portal-card" style={card}>
                  <h2 style={{ marginBottom: 12, fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--text)" }}>
                    Informations
                  </h2>
                  <div style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.65 }}>
                    <div>Adresse: {addressLine}</div>
                    <div>Téléphone: {client?.contact?.phone?.trim() || "—"}</div>
                  </div>
                  <div className="portal-desktopDisconnect" style={{ gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                    <button
                      type="button"
                      onClick={() => signOut(auth)}
                      style={{
                        padding: "10px 16px",
                        borderRadius: 999,
                        background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                        color: "#fff",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 14,
                        fontWeight: 700,
                      }}
                    >
                      Déconnexion
                    </button>
                  </div>
                </section>
              ) : activeSection === "maintenance" ? (
                <ClientMaintenanceDashboard clientId={portalClientId} firebaseUserEmail={firebaseUser.email ?? null} />
              ) : activeSection === "contrats" ? (
                <ClientContractsDocuments
                  clientId={portalClientId}
                  firebaseUserEmail={firebaseUser.email ?? null}
                />
              ) : activeSection === "interventions" ? (
                <ClientInterventionsHistory clientId={portalClientId} firebaseUserEmail={firebaseUser.email ?? null} />
              ) : activeSection === "paiements" ? (
                <ClientPayments clientId={portalClientId} firebaseUserEmail={firebaseUser.email ?? null} />
              ) : (
                <section className="portal-card" style={{ ...card, padding: 0, overflow: "hidden" }}>
                  <PublicChatbotWidget
                    embedded
                    title="Assistant LabelEnergie"
                    subtitle="Reponses guidees depuis les CGV, la FAQ et la documentation publique"
                    welcomeMessage={`Bonjour ${displayName}, je peux vous aider sur votre contrat, la resiliation, les paiements, les documents ou les formules.`}
                    suggestions={[
                      "Comment resilier le contrat ?",
                      "Quels sont les moyens de paiement ?",
                      "Que couvre la formule VIP ?",
                      "Quand a lieu la visite annuelle ?",
                    ]}
                    placeholder="Posez votre question sur votre contrat, vos documents ou les CGV..."
                  />
                </section>
              )}
            </div>
 
            {/* Mobile only: help card moved to the end of the page */}
            <div className="portal-helpCardMobile" style={{ alignSelf: "stretch" }}>
              <div className="portal-card portal-helpCard" style={card}>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 800, color: "var(--text)" }}>
                  Besoin d’aide ?
                </div>
                <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.55 }}>
                  Notre équipe est disponible 7j/7. Décris ton besoin, on te répond rapidement.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const subject = encodeURIComponent("Aide — Portail client");
                    const body = encodeURIComponent(
                      `Bonjour,\n\nJ'ai besoin d'aide concernant mon portail client.\n\nNom: ${displayName}\nEmail: ${profileEmail}\n\nMessage:\n`
                    );
                    window.location.href = `mailto:contact@labelenergie.fr?subject=${subject}&body=${body}`;
                  }}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 999,
                    background: "#fff",
                    border: "1px solid rgba(0,184,220,0.24)",
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--text)",
                  }}
                >
                  Nous contacter
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assistant visible sur tout le portail (bouton flottant) */}
      {firebaseUser ? (
        <PublicChatbotWidget
          title="Assistant LabelEnergie"
          subtitle="Aide rapide (CGV, FAQ, documentation)"
          welcomeMessage={`Bonjour ${displayName}, je peux vous aider sur votre contrat, vos paiements, vos documents et les conditions (CGV).`}
          suggestions={[
            "Comment resilier le contrat ?",
            "Quels sont les moyens de paiement ?",
            "Ou telecharger mon contrat ?",
            "Quand a lieu la visite annuelle ?",
          ]}
          placeholder="Posez votre question sur votre contrat, vos documents ou les CGV..."
        />
      ) : null}
    </>
  );
}
