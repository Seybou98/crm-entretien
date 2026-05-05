import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db } from "../../../lib/firebase";
import { CreateContractModal, type ContractRequestPayload } from "./CreateContractModal";
import {
  createPortalContractAndSendForSignature,
  createPortalMaintenanceForContract,
  downloadSignedContractFromBackend,
  getSignatureStatusFromBackend,
} from "../../lib/gocardless-backend";
import type { ContractPdfData, Equipment } from "../../utils/contract-pdf-generator";
import { downloadContractPdf } from "../../utils/contract-pdf-generator";

type ContractDoc = {
  id: string;
  clientId?: string;
  clientEmail?: string;
  clientName?: string;
  contractNumber?: string;
  equipmentName?: string;
  contractStartDate?: Timestamp;
  contractEndDate?: Timestamp;
  paymentStatus?: string;
  pdfUrl?: string;
  signedPdfUrl?: string;
  yousignRequestId?: string;
  signatureStatus?: "pending" | "signed" | "declined" | "expired";
};

type MaintenanceDoc = {
  id: string;
  clientId?: string;
  clientContact?: { email?: string };
  signerEmail?: string;
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
  productId?: string;
  productName?: string;
  formulaId?: string;
  formulaName?: string;
  estimatedMonthly?: number | null;
  equipmentDetails?: {
    marque?: string;
    modele?: string;
    dateMiseEnService?: string;
  };
  schedulePayment?: {
    desiredStartDate?: string;
    contractEndDate?: string;
    contractFrequency?: "12_months";
    monthlyAmount?: number;
    paymentInterval?: "monthly";
    paymentDate?: number;
    paymentMethod?: "gocardless" | "manual";
    gocardless?: {
      iban?: string;
      accountHolder?: string;
      address?: string;
      postalCode?: string;
      city?: string;
      country?: string;
    };
  };
  notes?: string;
  createdAt?: unknown;
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

export function ClientContractsDocuments({
  clientId,
  firebaseUserEmail,
}: {
  clientId: string | null;
  firebaseUserEmail: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [contracts, setContracts] = useState<ContractDoc[]>([]);
  const [liveSignatureStatusByContractId, setLiveSignatureStatusByContractId] = useState<
    Record<string, ContractDoc["signatureStatus"]>
  >({});
  const [maintDocs, setMaintDocs] = useState<MaintenanceUploadedDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSaving, setRequestSaving] = useState(false);
  const [downloadingContractId, setDownloadingContractId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!clientId && !firebaseUserEmail) {
        setLoading(false);
        setContracts([]);
        setMaintDocs([]);
        setError("Identifiant client introuvable.");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // 1) Contracts
        const contractsRef = collection(db, "contracts");
        const contractQueries = [];
        if (clientId) contractQueries.push(getDocs(query(contractsRef, where("clientId", "==", clientId))));
        if (firebaseUserEmail) contractQueries.push(getDocs(query(contractsRef, where("clientEmail", "==", firebaseUserEmail))));

        const contractSnaps = await Promise.all(contractQueries);
        const map = new Map<string, ContractDoc>();
        for (const snap of contractSnaps) {
          for (const d of snap.docs) {
            map.set(d.id, { id: d.id, ...(d.data() as Omit<ContractDoc, "id">) });
          }
        }

        // 2) Maintenance documents (uploads)
        const maintenancesRef = collection(db, "maintenances");
        const maintQueries: Array<ReturnType<typeof getDocs>> = [];
        if (clientId) maintQueries.push(getDocs(query(maintenancesRef, where("clientId", "==", clientId))));
        if (firebaseUserEmail) {
          // Fallback sur email (les règles Firestore le permettent)
          maintQueries.push(getDocs(query(maintenancesRef, where("clientContact.email", "==", firebaseUserEmail))));
          maintQueries.push(getDocs(query(maintenancesRef, where("signerEmail", "==", firebaseUserEmail))));
        }

        const maintSnaps = maintQueries.length ? await Promise.all(maintQueries) : [];
        const maintMap = new Map<string, MaintenanceDoc>();
        for (const snap of maintSnaps) {
          for (const d of snap.docs) {
            maintMap.set(d.id, { id: d.id, ...(d.data() as Omit<MaintenanceDoc, "id">) });
          }
        }

        const maintenances: MaintenanceDoc[] = Array.from(maintMap.values());

        const docsPerMaintenance = await Promise.all(
          maintenances.map(async (m) => {
            const docsSnap = await getDocs(collection(db, `maintenances/${m.id}/documents`));
            return docsSnap.docs.map((d) => ({
              id: d.id,
              maintenanceId: m.id,
              ...(d.data() as Omit<MaintenanceUploadedDoc, "id" | "maintenanceId">),
            }));
          })
        );

        if (!cancelled) {
          setContracts(Array.from(map.values()));
          setMaintDocs(docsPerMaintenance.flat());
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Impossible de charger vos contrats/documents.");
          setContracts([]);
          setMaintDocs([]);
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

  // Le portail lit `contracts.signatureStatus` dans Firestore, mais le CRM affiche souvent un statut "live"
  // via l’API DocuSign/Yousign. Ici on fait pareil pour éviter l’affichage "pending" alors que c’est signé.
  useEffect(() => {
    let cancelled = false;
    async function syncLiveSignatureStatus() {
      const targets = contracts.filter((c) => !!c.yousignRequestId && c.signatureStatus !== "signed");
      if (!targets.length) return;

      try {
        const entries = await Promise.all(
          targets.map(async (c) => {
            try {
              const r = await getSignatureStatusFromBackend({ requestId: c.yousignRequestId! });
              return [c.id, r.status] as const;
            } catch {
              return [c.id, undefined] as const;
            }
          })
        );

        if (cancelled) return;
        setLiveSignatureStatusByContractId((prev) => {
          const next = { ...prev };
          for (const [id, status] of entries) {
            if (status) next[id] = status;
          }
          return next;
        });
      } catch {
        // silent: on ne bloque pas l’affichage des contrats
      }
    }

    void syncLiveSignatureStatus();
    return () => {
      cancelled = true;
    };
  }, [contracts]);

  const hasAny = contracts.length > 0 || maintDocs.length > 0;

  const docsSorted = useMemo(() => {
    return [...maintDocs].sort((a, b) => {
      const ta = a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
      const tb = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      return tb - ta;
    });
  }, [maintDocs]);

  async function requestContract(payload: ContractRequestPayload) {
    if (!clientId) {
      setError("Impossible de créer une demande sans clientId.");
      return;
    }

    setRequestSaving(true);
    setRequestError(null);
    try {
      console.log("[Portal][Contract] requestContract: start", {
        clientId,
        contractNumber: payload.contractNumber,
      });
      if (!firebaseUserEmail) {
        throw new Error("Email client introuvable : veuillez vous reconnecter.");
      }

      const maintenancesRef = collection(db, "maintenances");
      const maintQueries: Array<ReturnType<typeof getDocs>> = [];
      if (clientId) maintQueries.push(getDocs(query(maintenancesRef, where("clientId", "==", clientId))));
      maintQueries.push(getDocs(query(maintenancesRef, where("clientContact.email", "==", firebaseUserEmail))));
      maintQueries.push(getDocs(query(maintenancesRef, where("signerEmail", "==", firebaseUserEmail))));

      const maintSnaps = maintQueries.length ? await Promise.all(maintQueries) : [];
      const allDocs = maintSnaps.flatMap((s) => s.docs);
      const first = allDocs[0];

      let maintenanceId = first?.id ?? null;
      if (!maintenanceId) {
        console.warn("[Portal][Contract] aucune maintenance trouvée, création auto côté backend…");
        const equipmentName =
          payload.products.length === 1
            ? payload.products[0].name
            : `${payload.products[0].name} + ${payload.products.length - 1} autre(s)`;
        const created = await createPortalMaintenanceForContract({
          clientId,
          clientName: payload.schedulePayment.gocardless.accountHolder?.trim() || "Client",
          signerEmail: firebaseUserEmail,
          contractNumber: payload.contractNumber,
          contractStartDate: payload.schedulePayment.desiredStartDate,
          contractEndDate: payload.schedulePayment.contractEndDate,
          monthlyAmount: payload.schedulePayment.monthlyAmount,
          paymentDate: payload.schedulePayment.paymentDate,
          paymentMethod: payload.schedulePayment.paymentMethod,
          equipmentName,
          gocardlessIban: payload.schedulePayment.gocardless.iban,
          gocardlessAccountHolder: payload.schedulePayment.gocardless.accountHolder,
          gocardlessAddress: payload.schedulePayment.gocardless.address,
          gocardlessPostalCode: payload.schedulePayment.gocardless.postalCode,
          gocardlessCity: payload.schedulePayment.gocardless.city,
          gocardlessCountry: payload.schedulePayment.gocardless.country,
        });
        maintenanceId = created.maintenanceId;
      }
      console.log("[Portal][Contract] maintenance ready", { maintenanceId });

      // 1) Générer le PDF du contrat (comme dans l’aperçu)
      const contractEndDate = new Date(`${payload.schedulePayment.contractEndDate}T00:00:00`);
      const createdAt = new Date();
      const clientName = payload.schedulePayment.gocardless.accountHolder?.trim() || "Client";

      const equipmentName =
        payload.products.length === 1
          ? payload.products[0].name
          : `${payload.products[0].name} + ${payload.products.length - 1} autre(s)`;

      const equipment: Equipment[] = payload.products.map((p, idx) => {
        const d = payload.equipmentDetailsByProductId[p.id];
        return {
          id: `equipment-${idx}`,
          name: p.name,
          price: 0,
          selected: true,
          hasImage: false,
          typeId: p.id,
          fields: [
            { label: "Marque", value: d?.marque?.trim() || "" },
            { label: "Modèle", value: d?.modele?.trim() || "" },
            { label: "Date de mise en service", value: d?.dateMiseEnService || "" },
          ],
        };
      });

      const pdfData: ContractPdfData = {
        contractNumber: payload.contractNumber,
        clientName,
        equipmentName,
        createdAt,
        contractEndDate,
        monthlyAmount: payload.schedulePayment.monthlyAmount,
        equipment,
        clientAddress: {
          street: payload.schedulePayment.gocardless.address,
          postalCode: payload.schedulePayment.gocardless.postalCode,
          city: payload.schedulePayment.gocardless.city,
          country: payload.schedulePayment.gocardless.country,
        },
        gocardlessAccountHolder: payload.schedulePayment.gocardless.accountHolder,
        gocardlessAddress: payload.schedulePayment.gocardless.address,
        gocardlessPostalCode: payload.schedulePayment.gocardless.postalCode,
        gocardlessCity: payload.schedulePayment.gocardless.city,
        gocardlessCountry: payload.schedulePayment.gocardless.country,
        gocardlessIban: payload.schedulePayment.gocardless.iban,
        paymentMethod: payload.schedulePayment.paymentMethod,
        paymentDate: payload.schedulePayment.paymentDate,
        paymentStatus: "pending",
        signatureStatus: "pending",
      };

      console.log("[Portal][Contract] generating PDF…");
      const pdfBlob = await downloadContractPdf(pdfData, false);
      console.log("[Portal][Contract] PDF generated", { bytes: pdfBlob.size });

      // 2) Uploader le PDF pour que le backend puisse lancer la signature
      const storage = getStorage();
      const fileName = `${payload.contractNumber}.pdf`;
      const filePath = `maintenances/${maintenanceId}/documents/${fileName}`;
      const pdfFileRef = storageRef(storage, filePath);
      console.log("[Portal][Contract] uploading PDF to Storage", { filePath });
      await uploadBytes(pdfFileRef, pdfBlob);
      const pdfUrl = await getDownloadURL(pdfFileRef);
      console.log("[Portal][Contract] PDF uploaded", { pdfUrl: pdfUrl.slice(0, 60) + "…" });

      // 3) Déterminer le nom du signataire (titulaire du compte)
      const fullName = payload.schedulePayment.gocardless.accountHolder.trim();
      const parts = fullName.split(/\s+/).filter(Boolean);
      const signerFirstName = parts[0] ?? "";
      const signerLastName = parts.slice(1).join(" ");

      // 4) Backend : créer les docs Firestore + envoyer pour signature
      console.log("[Portal][Contract] calling backend /api/portal/create-contract…");
      const createdContract = await createPortalContractAndSendForSignature({
        maintenanceId: maintenanceId!,
        contractNumber: payload.contractNumber,
        pdfUrl,
        signerEmail: firebaseUserEmail,
        signerFirstName,
        signerLastName,
        equipmentName,
        contractStartDate: payload.schedulePayment.desiredStartDate,
        contractEndDate: payload.schedulePayment.contractEndDate,
        monthlyAmount: payload.schedulePayment.monthlyAmount,
        paymentDate: payload.schedulePayment.paymentDate,
        paymentMethod: payload.schedulePayment.paymentMethod,
        gocardlessIban: payload.schedulePayment.gocardless.iban,
        gocardlessAccountHolder: payload.schedulePayment.gocardless.accountHolder,
        gocardlessAddress: payload.schedulePayment.gocardless.address,
        gocardlessPostalCode: payload.schedulePayment.gocardless.postalCode,
        gocardlessCity: payload.schedulePayment.gocardless.city,
        gocardlessCountry: payload.schedulePayment.gocardless.country,
      });
      console.log("[Portal][Contract] backend responded OK", createdContract);

      // Debug : tenter de lire le contrat juste créé
      try {
        const contractSnap = await getDoc(doc(db, "contracts", createdContract.contractId));
        console.log("[Portal][Contract] getDoc contract exists?", contractSnap.exists());
      } catch (e) {
        console.warn("[Portal][Contract] getDoc contract failed:", e instanceof Error ? e.message : e);
      }

      setRequestOpen(false);

      // 5) Refresh : contrats + documents
      const contractsRef = collection(db, "contracts");
      const contractQueries = [];
      if (clientId) contractQueries.push(getDocs(query(contractsRef, where("clientId", "==", clientId))));
      if (firebaseUserEmail)
        contractQueries.push(getDocs(query(contractsRef, where("clientEmail", "==", firebaseUserEmail))));

      const contractSnaps = await Promise.all(contractQueries);
      const contractMap = new Map<string, ContractDoc>();
      for (const snap of contractSnaps) {
        for (const d of snap.docs) {
          contractMap.set(d.id, { id: d.id, ...(d.data() as Omit<ContractDoc, "id">) });
        }
      }

      setContracts(Array.from(contractMap.values()));
      console.log("[Portal][Contract] refresh contracts found", contractMap.size);

      // Maintenance docs (uploads / documents)
      const maintenancesRefRefresh = collection(db, "maintenances");
      const maintQueries2: Array<ReturnType<typeof getDocs>> = [];
      if (clientId) maintQueries2.push(getDocs(query(maintenancesRefRefresh, where("clientId", "==", clientId))));
      if (firebaseUserEmail) {
        maintQueries2.push(getDocs(query(maintenancesRefRefresh, where("clientContact.email", "==", firebaseUserEmail))));
        maintQueries2.push(getDocs(query(maintenancesRefRefresh, where("signerEmail", "==", firebaseUserEmail))));
      }

      const maintSnaps2 = maintQueries2.length ? await Promise.all(maintQueries2) : [];
      const maintMap2 = new Map<string, MaintenanceDoc>();
      for (const snap of maintSnaps2) {
        for (const d of snap.docs) {
          maintMap2.set(d.id, { id: d.id, ...(d.data() as Omit<MaintenanceDoc, "id">) });
        }
      }
      const maintenances: MaintenanceDoc[] = Array.from(maintMap2.values());
      console.log("[Portal][Contract] refresh maintenances found", maintenances.length);

      const docsPerMaintenance = await Promise.all(
        maintenances.map(async (m) => {
          const docsSnap = await getDocs(collection(db, `maintenances/${m.id}/documents`));
          return docsSnap.docs.map((d) => ({
            id: d.id,
            maintenanceId: m.id,
            ...(d.data() as Omit<MaintenanceUploadedDoc, "id" | "maintenanceId">),
          }));
        })
      );
      setMaintDocs(docsPerMaintenance.flat());
      console.log("[Portal][Contract] refresh maint docs found", docsPerMaintenance.flat().length);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur lors de la demande de contrat.";
      console.error("[Portal][Contract] requestContract failed", e);
      setRequestError(msg);
    } finally {
      setRequestSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={card}>
        <h2 style={{ marginBottom: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--text)" }}>
          Contrats & documents
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>Chargement…</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 18, color: "var(--text)" }}>
              Contrats & documents
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
              Retrouvez vos contrats d’entretien et vos documents (PDF) associés à vos maintenances.
            </p>
          </div>
          {!hasAny ? (
            <button
              type="button"
              onClick={() => {
                setRequestError(null);
                setRequestOpen(true);
              }}
              style={{
                padding: "10px 16px",
                borderRadius: 999,
                background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14,
                fontWeight: 500,
                boxShadow: "0 4px 16px rgba(0,184,220,0.18)",
              }}
            >
              Créer un contrat
            </button>
          ) : null}
        </div>

        {error ? (
          <div style={{ marginTop: 12, color: "#b42318", fontSize: 13 }}>{error}</div>
        ) : null}
      </div>

      {contracts.length ? (
        <div style={card}>
          <h3 style={{ marginBottom: 12, fontFamily: "'DM Sans', sans-serif", fontSize: 16, color: "var(--text)" }}>
            Contrats
          </h3>
          <div style={{ display: "grid", gap: 10 }}>
            {contracts.map((c) => {
              const url = c.signedPdfUrl || c.pdfUrl;
              // Le statut peut ne pas être synchronisé immédiatement côté Firestore (webhook/polling).
              // Si on a un yousignRequestId, on propose le download backend.
              const canBackendDownload = !url && !!c.yousignRequestId;
              const effectiveSignatureStatus = liveSignatureStatusByContractId[c.id] || c.signatureStatus;
              return (
                <div
                  key={c.id}
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
                    <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>
                      {c.contractNumber ? `Contrat #${c.contractNumber}` : "Contrat"}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      {c.equipmentName ? `${c.equipmentName} · ` : ""}
                      {fmtDate(c.contractStartDate)} → {fmtDate(c.contractEndDate)}
                    </div>
                    {effectiveSignatureStatus ? (
                      <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 6 }}>
                        Signature:{" "}
                        {effectiveSignatureStatus === "signed"
                          ? "Signé"
                          : effectiveSignatureStatus === "pending"
                            ? "En attente"
                            : effectiveSignatureStatus === "declined"
                              ? "Refusé"
                              : "Expiré"}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {url ? (
                      <a
                        href={url}
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
                        Ouvrir PDF
                      </a>
                    ) : canBackendDownload ? (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!c.yousignRequestId) return;
                          try {
                            setDownloadingContractId(c.id);
                            const filename = `Contrat_Signe_${c.contractNumber || c.yousignRequestId}.pdf`;
                            await downloadSignedContractFromBackend({ requestId: c.yousignRequestId, filename });
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Impossible de télécharger le contrat signé.");
                          } finally {
                            setDownloadingContractId(null);
                          }
                        }}
                        disabled={downloadingContractId === c.id}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 999,
                          background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                          border: "none",
                          color: "#fff",
                          cursor: downloadingContractId === c.id ? "not-allowed" : "pointer",
                          fontSize: 13,
                          fontWeight: 700,
                          opacity: downloadingContractId === c.id ? 0.7 : 1,
                        }}
                        title="Télécharger le contrat signé"
                      >
                        {downloadingContractId === c.id ? "Téléchargement…" : "Télécharger contrat signé"}
                      </button>
                    ) : (
                      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>PDF indisponible</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {docsSorted.length ? (
        <div style={card}>
          <h3 style={{ marginBottom: 12, fontFamily: "'DM Sans', sans-serif", fontSize: 16, color: "var(--text)" }}>
            Documents
          </h3>
          <div style={{ display: "grid", gap: 10 }}>
            {docsSorted.map((d) => (
              <div
                key={`${d.maintenanceId}-${d.id}`}
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
                  <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>
                    {d.kind === "contract_request" ? "Demande de contrat" : d.name ?? "Document"}
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                    {d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString("fr-FR") : ""}
                    {d.size ? ` · ${bytesToMb(d.size)}` : ""}
                  </div>
                  {d.kind === "contract_request" && (d.productName || d.formulaName) ? (
                    <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                      {d.productName ? <div><strong>Produit:</strong> {d.productName}</div> : null}
                      {d.formulaName ? <div><strong>Formule:</strong> {d.formulaName}</div> : null}
                      {typeof d.estimatedMonthly === "number" ? (
                        <div><strong>Estimation:</strong> {d.estimatedMonthly.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/mois</div>
                      ) : d.formulaId === "vip" ? (
                        <div><strong>Estimation:</strong> Sur devis</div>
                      ) : null}
                      {d.equipmentDetails?.marque ? (
                        <div style={{ marginTop: 6 }}>
                          <strong>Équipement:</strong> {d.equipmentDetails.marque}
                          {d.equipmentDetails.modele ? ` · ${d.equipmentDetails.modele}` : ""}
                          {d.equipmentDetails.dateMiseEnService ? ` · Mise en service: ${new Date(d.equipmentDetails.dateMiseEnService).toLocaleDateString("fr-FR")}` : ""}
                        </div>
                      ) : null}
                      {d.schedulePayment?.desiredStartDate ? (
                        <div style={{ marginTop: 6 }}>
                          <strong>Planification:</strong> Début souhaité {new Date(d.schedulePayment.desiredStartDate).toLocaleDateString("fr-FR")}
                          {d.schedulePayment.contractEndDate ? ` · Fin ${new Date(d.schedulePayment.contractEndDate).toLocaleDateString("fr-FR")}` : ""}
                        </div>
                      ) : null}
                      {typeof d.schedulePayment?.monthlyAmount === "number" && d.formulaId !== "vip" ? (
                        <div>
                          <strong>Paiement:</strong> {d.schedulePayment.monthlyAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/mois
                        </div>
                      ) : null}
                      {d.notes ? <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{d.notes}</div> : null}
                    </div>
                  ) : d.kind === "contract_request" && d.message ? (
                    <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
                      {d.message}
                    </div>
                  ) : null}
                </div>
                <div>
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
                  ) : d.kind === "contract_request" ? (
                    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>En attente</span>
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Lien indisponible</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!hasAny ? (
        <div style={card}>
          <h3 style={{ marginBottom: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 16, color: "var(--text)" }}>
            Aucun contrat ni document
          </h3>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.65, marginBottom: 14 }}>
            Si vous venez de souscrire, la génération du contrat peut prendre un court délai. Vous pouvez aussi
            envoyer une demande.
          </p>
          <button
            type="button"
            onClick={() => setRequestOpen(true)}
            style={{
              padding: "10px 16px",
              borderRadius: 999,
              background: "linear-gradient(135deg,var(--cyan),var(--teal))",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 14,
              fontWeight: 500,
              boxShadow: "0 4px 16px rgba(0,184,220,0.18)",
            }}
          >
            Créer un contrat
          </button>
        </div>
      ) : null}

      <CreateContractModal
        isOpen={requestOpen}
        onClose={() => setRequestOpen(false)}
        submitting={requestSaving}
        submitError={requestError}
        onSubmit={async (payload) => {
          await requestContract(payload);
        }}
      />
    </div>
  );
}

