import { useEffect, useMemo, useRef, useState } from "react";
import type { ContractPdfData, Equipment } from "../../utils/contract-pdf-generator";
import { downloadContractPdf } from "../../utils/contract-pdf-generator";
import { auth, db } from "../../../lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export type ContractProduct = {
  id: string;
  name: string;
  icon: string;
  baseMonthlyFrom: number;
  image: string;
  eyebrow: string;
};

export type ContractFormula = {
  id: "standard" | "premium" | "vip";
  name: string;
  badge?: string;
  description: string;
};

export type ContractRequestPayload = {
  contractNumber: string;
  products: ContractProduct[];
  formula: ContractFormula;
  equipmentDetailsByProductId: Record<
    ContractProduct["id"],
    {
      marque: string;
      modele: string;
      dateMiseEnService: string;
    }
  >;
  schedulePayment: {
    desiredStartDate: string;
    contractEndDate: string;
    contractFrequency: "12_months";
    monthlyAmount: number;
    paymentInterval: "monthly";
    paymentDate: number; // day of month (1-28)
    paymentMethod: "gocardless" | "manual";
    gocardless: {
      iban: string;
      accountHolder: string;
      address: string;
      postalCode: string;
      city: string;
      country: string;
    };
  };
  notes: string;
};

type EquipmentDetailsState = {
  marque: string;
  modele: string;
  dateMiseEnService: string;
};

type SchedulePaymentState = {
  desiredStartDate: string;
  contractEndDate: string;
  contractFrequency: "12_months";
  monthlyAmount: number;
  paymentInterval: "monthly";
  paymentDate: number;
  paymentMethod: "gocardless" | "manual";
  gocardless: {
    iban: string;
    accountHolder: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
  };
};

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

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: 18,
  boxShadow: "var(--shadow-md)",
};

const PRODUCTS: ContractProduct[] = [
  {
    id: "pompe-air-eau",
    name: "Pompe à chaleur Air/Eau",
    icon: "♨",
    baseMonthlyFrom: 19.9,
    image: "/media.webp",
    eyebrow: "Installation premium",
  },
  {
    id: "pompe-air-air",
    name: "Pompe à chaleur Air/Air",
    icon: "❄",
    baseMonthlyFrom: 19.9,
    image: "/pompe-chaleur-air-air.jpg",
    eyebrow: "Le plus demandé",
  },
  {
    id: "chauffe-eau-thermodynamique",
    name: "Chauffe-eau thermodynamique",
    icon: "🌡",
    baseMonthlyFrom: 9.9,
    image: "/chauffe-thermodynamique.webp",
    eyebrow: "Entretien essentiel",
  },
  {
    id: "poele-granule",
    name: "Poêle à granule",
    icon: "🔥",
    baseMonthlyFrom: 12.9,
    image: "/poele-a-granules.webp",
    eyebrow: "Confort quotidien",
  },
  {
    id: "chaudiere-granule",
    name: "Chaudière à granule",
    icon: "⚙",
    baseMonthlyFrom: 24.9,
    image: "/chaudiere-a-granules.avif",
    eyebrow: "Usage intensif",
  },
  {
    id: "systeme-solaire-combine",
    name: "Système solaire combiné",
    icon: "☀",
    baseMonthlyFrom: 24.9,
    image: "/systeme-solaire-combin.png",
    eyebrow: "Installation hybride",
  },
];

function productIconPath(productId: ContractProduct["id"]): string {
  switch (productId) {
    case "pompe-air-eau":
    case "pompe-air-air":
      return "/icon/pompe-chaleur.png";
    case "chauffe-eau-thermodynamique":
      return "/icon/ballon-dynamique.png";
    case "poele-granule":
      return "/icon/poele.png";
    case "chaudiere-granule":
      return "/icon/chaudiere.png";
    case "systeme-solaire-combine":
      return "/icon/systeme-solaire.png";
  }

  return "/icon/logo_cee.png";
}

const FORMULAS: ContractFormula[] = [
  {
    id: "standard",
    name: "Standard",
    description: "1 visite annuelle, 2 dépannages/an, attestation officielle et hotline dédiée.",
  },
  {
    id: "premium",
    name: "Premium",
    badge: "Recommandé",
    description: "3 dépannages/an, priorité renforcée, 10 % sur les pièces et hotline prioritaire.",
  },
  {
    id: "vip",
    name: "VIP",
    description: "Dépannages illimités en usage normal, 30 % sur les pièces et main-d'œuvre incluse.",
  },
];

function getMonthlyAmount(product: ContractProduct, formulaId: ContractFormula["id"]): number {
  const pricing: Record<ContractProduct["id"], Record<ContractFormula["id"], number>> = {
    "pompe-air-eau": { standard: 19.9, premium: 24.9, vip: 34.9 },
    "pompe-air-air": { standard: 19.9, premium: 24.9, vip: 34.9 },
    "chauffe-eau-thermodynamique": { standard: 9.9, premium: 14.9, vip: 19.9 },
    "poele-granule": { standard: 12.9, premium: 19.9, vip: 24.9 },
    "chaudiere-granule": { standard: 24.9, premium: 34.9, vip: 39.9 },
    "systeme-solaire-combine": { standard: 24.9, premium: 34.9, vip: 39.9 },
  };

  return pricing[product.id][formulaId];
}

type Step = "produit" | "formule" | "equipment_details" | "equipment_recap" | "schedule" | "details" | "apercu";

export function CreateContractModal({
  isOpen,
  onClose,
  onSubmit,
  submitting,
  submitError,
  presetFormulaId,
  onRequireAuth,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: ContractRequestPayload) => Promise<void> | void;
  
  submitting: boolean;
  submitError?: string | null;
  /** Si défini, la formule est pré-sélectionnée (Standard/Premium/VIP) */
  presetFormulaId?: ContractFormula["id"];
  /** Appelé si l'utilisateur doit se connecter pour continuer */
  onRequireAuth?: () => void;
}) {
  const [step, setStep] = useState<Step>("formule");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedFormulaId, setSelectedFormulaId] = useState<ContractFormula["id"] | null>(null);
  const [notes, setNotes] = useState("");
  const [equipmentDetailsByProductId, setEquipmentDetailsByProductId] = useState<Record<string, EquipmentDetailsState>>(
    () => ({})
  );
  const [equipmentProductIdx, setEquipmentProductIdx] = useState(0);
  const [schedulePayment, setSchedulePayment] = useState<SchedulePaymentState>({
    desiredStartDate: new Date().toISOString().slice(0, 10),
    contractEndDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10),
    contractFrequency: "12_months",
    monthlyAmount: 0,
    paymentInterval: "monthly",
    paymentDate: 1,
    paymentMethod: "gocardless",
    gocardless: {
      iban: "",
      accountHolder: "",
      address: "",
      postalCode: "",
      city: "",
      country: "France",
    },
  });

  const [previewGenerating, setPreviewGenerating] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [previewContractNumber, setPreviewContractNumber] = useState<string>(() => {
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `CONTRACT-PREVIEW-${rnd}`;
  });
  const lastPreviewKeyRef = useRef<string | null>(null);
  const previewSectionRef = useRef<HTMLDivElement | null>(null);

  const selectedProduct = useMemo(
    () => PRODUCTS.find((p) => p.id === selectedProductIds[equipmentProductIdx]) ?? null,
    [selectedProductIds, equipmentProductIdx]
  );
  const selectedProducts = useMemo(
    () => selectedProductIds.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean) as ContractProduct[],
    [selectedProductIds]
  );
  const selectedFormula = useMemo(
    () => FORMULAS.find((f) => f.id === selectedFormulaId) ?? null,
    [selectedFormulaId]
  );

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const apply = () => setIsMobile(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  // Auto-remplissage des infos GoCardless depuis le profil client (collection clients / client_entretien)
  // pour éviter de redemander l'adresse à un client déjà connu.
  useEffect(() => {
    if (!isOpen) return;
    const u = auth.currentUser;
    if (!u) return;
    const uid = u.uid;

    let cancelled = false;

    async function autofillFromClientProfile() {
      try {
        const portalSnap = await getDoc(doc(db, PORTAL_USERS_COL, uid));
        if (!portalSnap.exists()) return;
        const portal = portalSnap.data() as { clientId?: string; clientSource?: "clients" | "client_entretien" };
        const clientId = portal.clientId;
        if (!clientId) return;

        const source = portal.clientSource ?? "clients";
        const col = source === "client_entretien" ? CLIENT_ENTRETIEN_COL : CRM_CLIENTS_COL;
        const clientSnap = await getDoc(doc(db, col, clientId));
        if (!clientSnap.exists()) return;
        const client = clientSnap.data() as CRMClient;

        const first = client.contact?.firstName?.trim() ?? "";
        const last = client.contact?.lastName?.trim() ?? "";
        const fullName = [first, last].filter(Boolean).join(" ").trim() || client.name?.trim() || "";

        const street = client.address?.street?.trim() ?? "";
        const postalCode = client.address?.postalCode?.trim() ?? "";
        const city = client.address?.city?.trim() ?? "";
        const country = client.address?.country?.trim() ?? "";

        if (cancelled) return;

        setSchedulePayment((p) => {
          const next = { ...p, gocardless: { ...p.gocardless } };

          // On ne remplace pas une saisie existante.
          if (!next.gocardless.accountHolder.trim() && fullName) next.gocardless.accountHolder = fullName;
          if (!next.gocardless.address.trim() && street) next.gocardless.address = street;
          if (!next.gocardless.postalCode.trim() && postalCode) next.gocardless.postalCode = postalCode;
          if (!next.gocardless.city.trim() && city) next.gocardless.city = city;
          if (!next.gocardless.country.trim() && country) next.gocardless.country = country;

          return next;
        });
      } catch {
        // best-effort: ne pas bloquer l'utilisateur si le profil n'est pas accessible.
      }
    }

    void autofillFromClientProfile();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Landing: formule pré-choisie (Standard/Premium/VIP) avant ouverture du modal.
  useEffect(() => {
    if (!isOpen) return;
    if (!presetFormulaId) return;
    setSelectedFormulaId(presetFormulaId);
  }, [isOpen, presetFormulaId]);

  const currentEquipmentDetails: EquipmentDetailsState = useMemo(() => {
    const pid = selectedProduct?.id;
    if (!pid) {
      return { marque: "", modele: "", dateMiseEnService: new Date().toISOString().slice(0, 10) };
    }
    const existing = equipmentDetailsByProductId[pid];
    return (
      existing ?? {
        marque: "",
        modele: "",
        dateMiseEnService: new Date().toISOString().slice(0, 10),
      }
    );
  }, [equipmentDetailsByProductId, selectedProduct]);

  // Alias used throughout the JSX (single-current-product view).
  const equipmentDetails = currentEquipmentDetails;

  const equipmentCompleted = currentEquipmentDetails.marque.trim().length > 0;
  const goCardlessValid =
    schedulePayment.paymentMethod !== "gocardless" ||
    (schedulePayment.gocardless.iban.trim() &&
      schedulePayment.gocardless.accountHolder.trim() &&
      schedulePayment.gocardless.address.trim() &&
      schedulePayment.gocardless.postalCode.trim() &&
      schedulePayment.gocardless.city.trim() &&
      schedulePayment.gocardless.country.trim());

  const scheduleValid =
    schedulePayment.paymentDate >= 1 &&
    schedulePayment.paymentDate <= 28 &&
    !!schedulePayment.desiredStartDate &&
    !!schedulePayment.contractEndDate &&
    schedulePayment.monthlyAmount > 0 &&
    goCardlessValid;

  const isAuthed = !!auth.currentUser;
  // Connexion requise APRÈS l'étape Équipement (avant Paiement).
  // Avec l'étape "Récap", la connexion est demandée pour passer du récap au paiement.
  const needsAuthToContinue = step === "equipment_recap" && !isAuthed;

  const canNext =
    (step === "produit" && selectedProductIds.length > 0) ||
    (step === "formule" && !!selectedFormula) ||
    (step === "equipment_details" && equipmentCompleted) ||
    step === "equipment_recap" ||
    (step === "schedule" && scheduleValid) ||
    step === "details" ||
    step === "apercu";

  const stepIndex = useMemo(() => {
    const order: Step[] = ["formule", "produit", "equipment_details", "equipment_recap", "schedule", "details", "apercu"];
    return order.indexOf(step);
  }, [step]);

  const progressPct = (() => {
    const total = 7;
    return ((stepIndex + 1) / total) * 100;
  })();

  function next() {
    if (needsAuthToContinue) {
      onRequireAuth?.();
      return;
    }
    if (!canNext) return;
    if (step === "formule") setStep("produit");
    else if (step === "produit") {
      setEquipmentProductIdx(0);
      setStep("equipment_details");
    }
    else if (step === "equipment_details") {
      if (equipmentProductIdx < selectedProducts.length - 1) {
        setEquipmentProductIdx((i) => i + 1);
      } else {
        setStep("equipment_recap");
      }
    }
    else if (step === "equipment_recap") setStep("schedule");
    else if (step === "schedule") setStep("details");
    else if (step === "details") setStep("apercu");
  }

  function back() {
    if (step === "produit") setStep("formule");
    else if (step === "equipment_details") {
      if (equipmentProductIdx > 0) {
        setEquipmentProductIdx((i) => i - 1);
      } else {
        setStep("produit");
      }
    }
    else if (step === "equipment_recap") setStep("equipment_details");
    else if (step === "schedule") setStep("equipment_recap");
    else if (step === "details") setStep("schedule");
    else if (step === "apercu") setStep("details");
  }

  async function submit() {
    if (!selectedProducts.length || !selectedFormula) return;
    console.log("[Portal][ContractModal] submit payload", {
      contractNumber: previewContractNumber,
      formulaId: selectedFormula.id,
      products: selectedProducts.map((p) => p.id),
      monthlyAmount: schedulePayment.monthlyAmount,
      paymentMethod: schedulePayment.paymentMethod,
      paymentDate: schedulePayment.paymentDate,
    });
    await onSubmit({
      contractNumber: previewContractNumber,
      products: selectedProducts,
      formula: selectedFormula,
      equipmentDetailsByProductId: Object.fromEntries(
        selectedProducts.map((p) => {
          const details =
            equipmentDetailsByProductId[p.id] ?? ({ marque: "", modele: "", dateMiseEnService: new Date().toISOString().slice(0, 10) } as EquipmentDetailsState);
          return [
            p.id,
            {
              marque: details.marque.trim(),
              modele: details.modele.trim(),
              dateMiseEnService: details.dateMiseEnService,
            },
          ];
        })
      ),
      schedulePayment: {
        desiredStartDate: schedulePayment.desiredStartDate,
        contractEndDate: schedulePayment.contractEndDate,
        contractFrequency: schedulePayment.contractFrequency,
        monthlyAmount: schedulePayment.monthlyAmount,
        paymentInterval: schedulePayment.paymentInterval,
        paymentDate: schedulePayment.paymentDate,
        paymentMethod: schedulePayment.paymentMethod,
        gocardless: schedulePayment.gocardless,
      },
      notes: notes.trim(),
    });
  }

  const estimatedPrice =
    selectedProducts.length && selectedFormula
      ? selectedProducts.reduce((sum, p) => sum + getMonthlyAmount(p, selectedFormula.id), 0)
      : null;

  useEffect(() => {
    if (!selectedProducts.length || !selectedFormula) return;

    // In this flow the amount is computed and must not be editable by the user.
    const est = selectedProducts.reduce((sum, p) => sum + getMonthlyAmount(p, selectedFormula.id), 0);
    setSchedulePayment((p) => ({ ...p, monthlyAmount: est }));
  }, [selectedProductIds, selectedFormulaId, selectedProducts, selectedFormula]);

  useEffect(() => {
    // Le mode de paiement est verrouillé sur GoCardless.
    setSchedulePayment((p) => (p.paymentMethod === "gocardless" ? p : { ...p, paymentMethod: "gocardless" }));
  }, []);

  useEffect(() => {
    const ymd = schedulePayment.desiredStartDate;
    if (!ymd) return;

    // Contract end date is fixed to +1 year (non-editable in the UI).
    const [y, m, d] = ymd.split("-").map((n) => Number(n));
    if (!y || !m || !d) return;

    const endUtc = new Date(Date.UTC(y, m - 1, d));
    endUtc.setUTCFullYear(endUtc.getUTCFullYear() + 1);
    const endYmd = endUtc.toISOString().slice(0, 10);

    setSchedulePayment((p) => {
      if (p.contractEndDate === endYmd) return p;
      return { ...p, contractEndDate: endYmd, contractFrequency: "12_months" };
    });
  }, [schedulePayment.desiredStartDate]);

  const previewKey = useMemo(() => {
    if (!selectedProducts.length || !selectedFormula) return null;
    return JSON.stringify({
      previewContractNumber,
      productIds: selectedProductIds,
      formulaId: selectedFormula.id,
      equipmentDetailsByProductId,
      equipmentProductIdx,
      schedulePayment,
      notes,
    });
  }, [
    previewContractNumber,
    selectedProductIds,
    selectedProducts,
    selectedFormula,
    equipmentDetailsByProductId,
    equipmentProductIdx,
    schedulePayment,
    notes,
  ]);

  useEffect(() => {
    // Reset state when opening/closing the modal to avoid showing an outdated PDF.
    if (!isOpen) {
      if (previewPdfUrl) URL.revokeObjectURL(previewPdfUrl);
      setPreviewPdfUrl(null);
      setPreviewError(null);
      lastPreviewKeyRef.current = null;
      return;
    }

    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    setPreviewContractNumber(`CONTRACT-PREVIEW-${rnd}`);
    setPreviewPdfUrl(null);
    setPreviewError(null);
    lastPreviewKeyRef.current = null;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || step !== "apercu") return;
    if (!selectedProducts.length || !selectedFormula) return;
    if (!scheduleValid) return;
    if (!previewKey) return;
    if (lastPreviewKeyRef.current === previewKey && previewPdfUrl) return;

    const contractEndDate = new Date(`${schedulePayment.contractEndDate}T00:00:00`);
    const createdAt = new Date();
    const clientName = schedulePayment.gocardless.accountHolder?.trim() || "Client";
    const equipmentName =
      selectedProducts.length === 1
        ? selectedProducts[0].name
        : `${selectedProducts[0].name} + ${selectedProducts.length - 1} autre(s)`;

    const equipment: Equipment[] = selectedProducts.map((p, idx) => {
      const details = equipmentDetailsByProductId[p.id] ?? equipmentDetails;
      const price = selectedFormula ? getMonthlyAmount(p, selectedFormula.id) : 0;
      return {
        id: `equipment-${idx}`,
        name: p.name,
        price,
        selected: true,
        hasImage: false,
        typeId: p.id,
        fields: [
          { label: "Marque", value: details.marque.trim() },
          { label: "Modèle", value: details.modele.trim() },
          { label: "Date de mise en service", value: details.dateMiseEnService },
        ],
      };
    });

    const pdfData: ContractPdfData = {
      contractNumber: previewContractNumber,
      clientName,
      equipmentName,
      createdAt,
      contractEndDate,
      monthlyAmount: schedulePayment.monthlyAmount,
      equipment,
      clientAddress: {
        street: schedulePayment.gocardless.address,
        postalCode: schedulePayment.gocardless.postalCode,
        city: schedulePayment.gocardless.city,
        country: schedulePayment.gocardless.country,
      },
      gocardlessAccountHolder: schedulePayment.gocardless.accountHolder,
      gocardlessAddress: schedulePayment.gocardless.address,
      gocardlessPostalCode: schedulePayment.gocardless.postalCode,
      gocardlessCity: schedulePayment.gocardless.city,
      gocardlessCountry: schedulePayment.gocardless.country,
      gocardlessIban: schedulePayment.gocardless.iban,
      paymentMethod: schedulePayment.paymentMethod,
      paymentDate: schedulePayment.paymentDate,
      paymentStatus: "pending",
      signatureStatus: "pending",
    };

    let cancelled = false;
    lastPreviewKeyRef.current = previewKey;
    setPreviewGenerating(true);
    setPreviewError(null);

    downloadContractPdf(pdfData, false)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPreviewPdfUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setPreviewError(msg);
      })
      .finally(() => {
        if (cancelled) return;
        setPreviewGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    step,
    selectedProduct,
    selectedFormula,
    scheduleValid,
    previewKey,
    previewPdfUrl,
    previewContractNumber,
    equipmentDetails,
    schedulePayment,
    notes,
  ]);

  // Petite UX : quand on arrive à l'étape "Aperçu" et que le PDF est prêt,
  // on scroll pour que l'utilisateur voie directement la prévisualisation.
  useEffect(() => {
    if (!isOpen) return;
    if (step !== "apercu") return;
    if (!previewPdfUrl && !previewError) return;
    previewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [isOpen, step, previewPdfUrl, previewError]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px var(--container-px)",
        zIndex: 600,
      }}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <style>{`
        .create-contract-modal__panel {
          scrollbar-width: none;      /* Firefox */
          -ms-overflow-style: none;   /* IE/Edge legacy */
        }
        .create-contract-modal__panel::-webkit-scrollbar {
          display: none;              /* Chrome/Safari */
        }
        .contract-product-card {
          position: relative;
          overflow: hidden;
          min-height: 240px;
          border-radius: 18px;
          border: 1px solid var(--border);
          background: #fff;
          cursor: pointer;
          box-shadow: 0 12px 28px rgba(13, 27, 42, 0.08);
          transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease;
        }
        .contract-product-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 34px rgba(13, 27, 42, 0.10);
          border-color: rgba(0, 184, 220, 0.24);
        }
        .contract-product-card.is-active {
          border-color: rgba(0, 184, 220, 0.9);
          box-shadow: 0 20px 38px rgba(0, 184, 220, 0.16);
        }
        .contract-product-card__media {
          position: relative;
          height: 108px;
          overflow: hidden;
          border-bottom: 1px solid rgba(13, 27, 42, 0.06);
          background: var(--bg2);
        }
        .contract-product-card__media img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          transform: scale(1.01);
          transition: transform .35s ease;
        }
        .contract-product-card:hover .contract-product-card__media img {
          transform: scale(1.05);
        }
        .contract-product-card__overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(8, 20, 32, 0.06) 0%, rgba(8, 20, 32, 0.52) 100%);
        }
        .contract-product-card__badge {
          position: absolute;
          left: 10px;
          top: 10px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(255, 255, 255, 0.72);
          color: var(--text);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: .06em;
          text-transform: uppercase;
          box-shadow: 0 10px 24px rgba(13, 27, 42, 0.10);
        }
        .contract-product-card__body {
          padding: 14px;
        }
        .contract-product-card__price {
          margin-top: 10px;
          display: inline-flex;
          align-items: baseline;
          gap: 6px;
          padding: 8px 10px;
          border-radius: 14px;
          background: rgba(0, 184, 220, 0.08);
          border: 1px solid rgba(0, 184, 220, 0.14);
        }
        .contract-product-card__check {
          position: absolute;
          right: 10px;
          top: 10px;
          width: 26px;
          height: 26px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, var(--cyan), var(--teal));
          color: #fff;
          font-size: 13px;
          font-weight: 900;
          box-shadow: 0 10px 24px rgba(0, 184, 220, 0.18);
        }
        @media (max-width: 640px) {
          .contract-product-card {
            min-height: 220px;
          }
          .contract-product-card__media {
            height: 96px;
          }
          .contract-product-card__body {
            padding: 12px;
          }
        }
      `}</style>
      <div
        className="create-contract-modal__panel"
        style={{
          ...card,
          width: "100%",
          maxWidth: 760,
          padding: 18,
          // On donne plus de hauteur sur l'étape "Formule" (principal point de friction UX).
          maxHeight: step === "formule" ? "90vh" : "82vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 20, fontWeight: 800, color: "var(--text)" }}>
              Créer un contrat
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          {step === "formule"
            ? "Choisissez votre formule"
            : step === "produit"
              ? "Choisissez les produits à couvrir"
                  : step === "details"
                    ? "Ajoutez les détails utiles"
                    : "Vérifiez avant d’envoyer"}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              border: "1px solid var(--border)",
              background: "#fff",
              width: 40,
              height: 40,
              borderRadius: 999,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ height: 8, background: "rgba(0,0,0,0.06)", borderRadius: 999 }}>
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                background: "linear-gradient(90deg,var(--cyan),var(--teal))",
                borderRadius: 999,
                transition: "width .2s ease"
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
            <span style={{ fontWeight: step === "formule" ? 700 : 400, color: step === "formule" ? "var(--text)" : undefined }}>Formule</span>
            <span style={{ fontWeight: step === "produit" ? 700 : 400, color: step === "produit" ? "var(--text)" : undefined }}>Produit</span>
            <span style={{ fontWeight: step === "equipment_details" ? 700 : 400, color: step === "equipment_details" ? "var(--text)" : undefined }}>Équipement</span>
            <span style={{ fontWeight: step === "schedule" ? 700 : 400, color: step === "schedule" ? "var(--text)" : undefined }}>Paiement</span>
            <span style={{ fontWeight: step === "details" ? 700 : 400, color: step === "details" ? "var(--text)" : undefined }}>Notes</span>
            <span style={{ fontWeight: step === "apercu" ? 700 : 400, color: step === "apercu" ? "var(--text)" : undefined }}>Aperçu</span>
          </div>
        </div>

        <div style={{ marginTop: 16, paddingBottom: 86 }}>
          {/* {step === "formule" ? (
            presetFormulaId ? (
              <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg2)" }}>
                <div style={{ fontWeight: 800, color: "var(--text)", fontFamily: "'DM Sans', sans-serif" }}>
                  Formule sélectionnée
                </div>
                <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
                  {selectedFormula?.name ?? "—"}
                </div>
                <div style={{ marginTop: 10, color: "var(--text-muted)", fontSize: 13 }}>
                  Vous pouvez continuer, ou modifier la formule ci-dessous.
                </div>
              </div>
            ) : null
          ) : null} */}

          {step === "formule" ? (
            <div
              style={{
                display: "grid",
                gap: 14,
                gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
                alignItems: "stretch",
              }}
            >
              {FORMULAS.map((f) => {
                const active = f.id === selectedFormulaId;

                const details =
                  f.id === "standard"
                    ? {
                        badge: "Essentiel",
                        price: "À partir de 9,90 € /mois",
                        note: "Selon équipement",
                        summary:
                          "Pour garder l’essentiel sous contrôle avec une visite annuelle et une priorité d’intervention.",
                        features: [
                          "1 visite annuelle préventive",
                          "2 dépannages/an par équipement",
                          "Délai d'intervention sous 7 jours ouvrés",
                          "Attestation d'entretien officielle",
                          "Accès hotline 01 81 72 39 59",
                        ],
                        tone: "default" as const,
                      }
                    : f.id === "premium"
                      ? {
                          badge: "Le plus choisi",
                          price: "À partir de 14,90 € /mois",
                          // note: "Ex. PAC air/eau : 24,90 €/mois",
                          summary:
                            "Le meilleur équilibre entre sérénité, rapidité d’intervention et confort de suivi au quotidien.",
                          features: [
                            "1 visite annuelle préventive",
                            "3 dépannages/an par équipement",
                            "Délai d'intervention sous 5 jours ouvrés",
                            "Priorité renforcée — tête de file",
                            "−10% sur pièces de rechange",
                            "Hotline directe technicien senior",
                          ],
                          tone: "recommended" as const,
                        }
                      : {
                          badge: "maximal",
                          price: "À partir de 19,90 € /mois",
                          // note: "Ex. PAC air/eau : 34,90 €/mois",
                          summary:
                            "Pour les clients qui veulent une prise en charge prioritaire avec le niveau de service le plus élevé.",
                          features: [
                            "1 visite annuelle préventive",
                            "Dépannages illimités en usage normal",
                            "Délai d'intervention sous 3 jours ouvrés",
                            "Priorité absolue — premier servi",
                            "−30% sur les pièces de rechange",
                            "Main-d'œuvre dépannage incluse",
                          ],
                          tone: "default" as const,
                        };

                const showBadge = f.id === "premium" ? "Recommandé" : details.badge;

                return (
                  <div
                    key={f.id}
                    style={{
                      background:
                        details.tone === "recommended"
                          ? "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,250,252,0.96))"
                          : "#fff",
                      border: active ? "2px solid rgba(0,184,220,0.70)" : "1px solid rgba(13,27,42,0.10)",
                      borderRadius: 18,
                      padding: 16,
                      boxShadow: active ? "0 20px 52px rgba(13,27,42,0.12)" : "0 12px 30px rgba(13,27,42,0.06)",
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 0,
                      cursor: "pointer",
                    }}
                    role="button"
                    tabIndex={0}
                    aria-pressed={active}
                    aria-label={`Choisir la formule ${f.name}`}
                    onClick={() => setSelectedFormulaId(f.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedFormulaId(f.id);
                      }
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "7px 12px",
                            borderRadius: 999,
                            background: details.tone === "recommended" ? "rgba(0,184,220,0.12)" : "rgba(13,27,42,0.04)",
                            border:
                              details.tone === "recommended"
                                ? "1px solid rgba(0,184,220,0.18)"
                                : "1px solid rgba(13,27,42,0.06)",
                            fontSize: 11,
                            fontWeight: 800,
                            letterSpacing: ".08em",
                            textTransform: "uppercase",
                            color: details.tone === "recommended" ? "var(--cyan)" : "var(--text-muted)",
                            marginBottom: 10,
                          }}
                        >
                          {showBadge}
                        </div>
                        <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 18, fontWeight: 900, color: "var(--text)" }}>
                          {f.name}
                        </div>
                        <div style={{ marginTop: 4, fontFamily: "'DM Sans',sans-serif", fontSize: 16, fontWeight: 900, color: "var(--text)" }}>
                          {details.price}
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>{details.note}</div>
                      </div>

                        {/* {active ? (
                          <span
                            aria-hidden="true"
                            style={{
                              flexShrink: 0,
                              borderRadius: 999,
                              padding: "8px 10px",
                              background: "linear-gradient(135deg, var(--cyan), var(--teal))",
                              color: "#fff",
                              fontFamily: "'DM Sans',sans-serif",
                              fontWeight: 900,
                              fontSize: 12,
                              whiteSpace: "nowrap",
                              boxShadow: "0 12px 26px rgba(0,184,220,0.18)",
                            }}
                          >
                            Sélectionnée
                          </span>
                        ) : null} */}
                    </div>

                    <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.65 }}>
                      {details.summary}
                    </div>

                    <div style={{ height: 1, background: "rgba(13,27,42,0.08)", margin: "14px 0 12px" }} />

                    <div style={{ display: "grid", gap: 10 }}>
                      {details.features.map((feature) => (
                        <div
                          key={feature}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 10,
                            fontSize: 13,
                            color: "var(--text-secondary)",
                            lineHeight: 1.55,
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 999,
                              background: "rgba(0,201,167,0.12)",
                              border: "1px solid rgba(0,201,167,0.25)",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              color: "var(--teal)",
                              marginTop: 1,
                            }}
                          >
                            ✓
                          </span>
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary)" }}>
                      {selectedProductIds.length ? (
                        <div
                          style={{
                            padding: "10px 12px",
                            borderRadius: 14,
                            background: "rgba(13,27,42,0.03)",
                            border: "1px solid rgba(13,27,42,0.06)",
                          }}
                        >
                          {/* Estimation (multi-produits):{" "} */}
                          <strong style={{ color: "var(--text)" }}>
                            {selectedProducts
                              .reduce((sum, p) => sum + getMonthlyAmount(p, f.id), 0)
                              .toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                            €
                          </strong>{" "}
                          /mois (global)
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>Sélectionnez ensuite vos produits pour calculer une estimation.</span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFormulaId(f.id);
                      }}
                      className={details.tone === "recommended" ? "cta-primary-premium" : "cta-secondary-premium"}
                      style={{ width: "100%", marginTop: 14 }}
                      aria-label={`Choisir la formule ${f.name}`}
                    >
                      {active ? "Formule sélectionnée" : `Choisir ${f.name}`}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : step === "produit" ? (
            <div style={{ display: "grid", gap: 14 }}>
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                  alignItems: "start",
                }}
              >
                {PRODUCTS.map((p) => {
                  const active = selectedProductIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedProductIds((prev) => {
                          if (prev.includes(p.id)) return prev.filter((x) => x !== p.id);
                          return [...prev, p.id];
                        });
                      }}
                      style={{
                        textAlign: "left",
                        borderRadius: 16,
                        border: active ? "1.5px solid rgba(0,184,220,0.55)" : "1px solid rgba(13,27,42,0.10)",
                        background: active ? "rgba(0,184,220,0.06)" : "#fff",
                        padding: 12,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        cursor: "pointer",
                        transition: "background .15s, border-color .15s, transform .15s",
                      }}
                    >
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 14,
                          background: active
                            ? "linear-gradient(135deg, rgba(0,184,220,0.18), rgba(0,201,167,0.14))"
                            : "rgba(13,27,42,0.04)",
                          border: active ? "1px solid rgba(0,184,220,0.22)" : "1px solid rgba(13,27,42,0.06)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <img
                          src={productIconPath(p.id)}
                          alt=""
                          style={{ width: 28, height: 28, objectFit: "contain", display: "block" }}
                        />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 900, color: "var(--text)", fontSize: 13, lineHeight: 1.25 }}>
                          {p.name}
                        </div>
                        <div style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700 }}>
                            {selectedFormulaId
                              ? `dès ${getMonthlyAmount(p, selectedFormulaId).toLocaleString("fr-FR", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })} €/mois`
                              : `dès ${p.baseMonthlyFrom.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/mois`}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          border: active ? "none" : "1px solid rgba(13,27,42,0.18)",
                          background: active ? "linear-gradient(135deg, var(--cyan), var(--teal))" : "transparent",
                          color: active ? "#fff" : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          fontWeight: 900,
                          flexShrink: 0,
                        }}
                        aria-hidden="true"
                      >
                        ✓
                      </div>
                    </button>
                  );
                })}
              </div>

              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 16,
                  background: "#fff",
                  border: "1px solid rgba(13,27,42,0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900, color: "var(--text)", fontSize: 13 }}>
                    Produits sélectionnés ({selectedProductIds.length})
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Vous pourrez renseigner les détails pour chaque produit à l’étape suivante.
                  </div>
                </div>
                {selectedProductIds.length ? (
                  <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {selectedProducts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedProductIds((prev) => prev.filter((x) => x !== p.id))}
                        style={{
                          border: "1px solid rgba(0,184,220,0.16)",
                          background: "rgba(0,184,220,0.06)",
                          color: "var(--text-secondary)",
                          borderRadius: 999,
                          padding: "7px 10px",
                          fontSize: 12,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                        aria-label={`Retirer ${p.name}`}
                      >
                        <img src={productIconPath(p.id)} alt="" style={{ width: 16, height: 16, objectFit: "contain" }} />
                        <span style={{ fontWeight: 700 }}>{p.name}</span>
                        <span style={{ opacity: 0.7 }}>×</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop: 10, fontSize: 13, color: "var(--text-muted)" }}>
                    Sélectionne au moins un produit pour continuer.
                  </div>
                )}
              </div>
            </div>
          ) : step === "equipment_details" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 800, color: "var(--text)", fontFamily: "'DM Sans', sans-serif" }}>Détails de l'équipement</div>
                    <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
                      Remplissez les informations spécifiques à votre équipement.
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>
                      {equipmentProductIdx + 1}/{Math.max(1, selectedProducts.length)} complétés
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: equipmentCompleted ? "var(--teal)" : "var(--text-muted)", fontWeight: 700 }}>
                      {selectedProduct?.name ?? "Équipement"} {equipmentCompleted ? "✓ Complété" : "• À compléter"}
                    </div>
                  </div>
                </div>

                {needsAuthToContinue ? (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(245, 158, 11, 0.35)",
                      background: "rgba(245, 158, 11, 0.10)",
                      color: "rgba(120, 53, 15, 1)",
                      fontSize: 13,
                      lineHeight: 1.5,
                      fontWeight: 600,
                    }}
                  >
                    Vous devez être connecté pour passer à l’étape suivante.
                  </div>
                ) : null}

                <div style={{ marginTop: 14, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                      Marque <span style={{ color: "#b42318" }}>*</span>{" "}
                      <span style={{ fontSize: 12, color: equipmentCompleted ? "var(--teal)" : "var(--text-muted)", fontWeight: 600 }}>
                        ({equipmentCompleted ? "✓" : "•"}/1)
                      </span>
                    </span>
                    <input
                      value={equipmentDetails.marque}
                      onChange={(e) => {
                        if (!selectedProduct) return;
                        const v = e.target.value;
                        setEquipmentDetailsByProductId((prev) => ({
                          ...prev,
                          [selectedProduct.id]: { ...equipmentDetails, marque: v },
                        }));
                      }}
                      placeholder="Ex: Daikin, Mitsubishi"
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        padding: "10px 12px",
                        fontSize: 14,
                        outline: "none",
                        background: "#fff",
                      }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Modèle</span>
                    <input
                      value={equipmentDetails.modele}
                      onChange={(e) => {
                        if (!selectedProduct) return;
                        const v = e.target.value;
                        setEquipmentDetailsByProductId((prev) => ({
                          ...prev,
                          [selectedProduct.id]: { ...equipmentDetails, modele: v },
                        }));
                      }}
                      placeholder="Ex: 120S MONO"
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        padding: "10px 12px",
                        fontSize: 14,
                        outline: "none",
                        background: "#fff",
                      }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Date de mise en service</span>
                    <input
                      type="date"
                      value={equipmentDetails.dateMiseEnService}
                      onChange={(e) => {
                        if (!selectedProduct) return;
                        const v = e.target.value;
                        setEquipmentDetailsByProductId((prev) => ({
                          ...prev,
                          [selectedProduct.id]: { ...equipmentDetails, dateMiseEnService: v },
                        }));
                      }}
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        padding: "10px 12px",
                        fontSize: 14,
                        outline: "none",
                        background: "#fff",
                      }}
                    />
                  </label>
                </div>

                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      Progression
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>{equipmentCompleted ? "100%" : "0%"}</span>
                  </div>
                  <div style={{ height: 8, background: "rgba(0,0,0,0.06)", borderRadius: 999, marginTop: 6 }}>
                    <div
                      style={{
                        height: "100%",
                        width: equipmentCompleted ? "100%" : "0%",
                        background: equipmentCompleted ? "linear-gradient(90deg,var(--teal),var(--cyan))" : "transparent",
                        borderRadius: 999,
                        transition: "width .2s ease"
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : step === "equipment_recap" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg2)" }}>
                <div style={{ fontWeight: 900, color: "var(--text)", fontFamily: "'DM Sans', sans-serif", fontSize: 16 }}>
                  Récapitulatif avant paiement
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
                  Vérifiez les informations. Vous pourrez ensuite passer au paiement.
                </div>

                {needsAuthToContinue ? (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(245, 158, 11, 0.35)",
                      background: "rgba(245, 158, 11, 0.10)",
                      color: "rgba(120, 53, 15, 1)",
                      fontSize: 13,
                      lineHeight: 1.5,
                      fontWeight: 600,
                    }}
                  >
                    Vous devez être connecté pour accéder à l’étape paiement.
                  </div>
                ) : null}

                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.10)",
                    background: "#fff",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Récapitulatif
                  </div>
                  <div style={{ marginTop: 8, display: "grid", gap: 8, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                    <div>
                      <strong style={{ color: "var(--text)" }}>Produits:</strong>{" "}
                      {selectedProducts.length ? selectedProducts.map((p) => p.name).join(", ") : "—"}
                    </div>
                    <div>
                      <strong style={{ color: "var(--text)" }}>Formule:</strong> {selectedFormula?.name ?? "—"}
                    </div>
                    <div>
                      <strong style={{ color: "var(--text)" }}>Tarif:</strong>{" "}
                      {estimatedPrice != null
                        ? `${estimatedPrice.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/mois`
                        : "—"}
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <strong style={{ color: "var(--text)" }}>Équipement(s):</strong>
                      <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
                        {selectedProducts.map((p) => {
                          const d = equipmentDetailsByProductId[p.id] ?? { marque: "", modele: "", dateMiseEnService: "" };
                          return (
                            <div
                              key={p.id}
                              style={{
                                padding: 12,
                                borderRadius: 12,
                                border: "1px solid rgba(13,27,42,0.08)",
                                background: "var(--bg2)",
                              }}
                            >
                              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                <img src={productIconPath(p.id)} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />
                                <div style={{ fontWeight: 900, color: "var(--text)", fontSize: 13 }}>{p.name}</div>
                              </div>
                              <div style={{ marginTop: 8, color: "var(--text-muted)", lineHeight: 1.6 }}>
                                <div>Marque: {d.marque?.trim() || "—"}</div>
                                <div>Modèle: {d.modele?.trim() || "—"}</div>
                                <div>Date de mise en service: {d.dateMiseEnService || "—"}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {notes.trim() ? (
                      <div style={{ marginTop: 4 }}>
                        <strong style={{ color: "var(--text)" }}>Notes:</strong>{" "}
                        <span style={{ color: "var(--text-muted)" }}>{notes.trim()}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : step === "schedule" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg2)" }}>
                <div style={{ fontWeight: 800, color: "var(--text)", fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>
                  Planification & paiement
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
                  Indiquez votre date souhaitée et vos préférences de paiement. (Le traitement final se fait par l’équipe LabelEnergie.)
                </div>

                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                  {/* <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Date souhaitée de début</span>
                    <input
                      type="date"
                      value={schedulePayment.desiredStartDate}
                      onChange={(e) => setSchedulePayment((p) => ({ ...p, desiredStartDate: e.target.value }))}
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        padding: "10px 12px",
                        fontSize: 14,
                        outline: "none",
                        background: "#fff",
                      }}
                    />
                  </label> */}

                  {/* <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Date de fin de contrat</span>
                    <input
                      type="date"
                      value={schedulePayment.contractEndDate}
                      disabled
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        padding: "10px 12px",
                        fontSize: 14,
                        outline: "none",
                        background: "rgba(0,0,0,0.04)",
                      }}
                    />
                  </label> */}

                  {/* <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Fréquence du contrat</span>
                    <select
                      value={schedulePayment.contractFrequency}
                      disabled
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        padding: "10px 12px",
                        fontSize: 14,
                        outline: "none",
                        background: "rgba(0,0,0,0.04)",
                      }}
                    >
                      <option value="12_months">Tous les 12 mois</option>
                    </select>
                  </label> */}

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Montant mensuel (calculé)</span>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={schedulePayment.monthlyAmount}
                      disabled
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        padding: "10px 12px",
                        fontSize: 14,
                        outline: "none",
                        background: "rgba(0,0,0,0.04)",
                      }}
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Périodicité</span>
                    <div
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        padding: "10px 12px",
                        fontSize: 14,
                        outline: "none",
                        background: "rgba(0,0,0,0.04)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      Mensuel
                    </div>
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Jour de prélèvement (1-28)</span>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      step={1}
                      value={schedulePayment.paymentDate}
                      onChange={(e) =>
                        setSchedulePayment((p) => ({ ...p, paymentDate: Math.max(1, Math.min(28, Number(e.target.value || 1))) }))
                      }
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        padding: "10px 12px",
                        fontSize: 14,
                        outline: "none",
                        background: "#fff",
                      }}
                    />
                  </label>
                </div>

                <div style={{ height: 1, background: "var(--border)", margin: "14px 0" }} />

                <div style={{ display: "grid", gap: 12 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>Mode de paiement</span>
                    <select
                      value={schedulePayment.paymentMethod}
                      disabled
                      style={{
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        padding: "10px 12px",
                        fontSize: 14,
                        outline: "none",
                        background: "rgba(0,0,0,0.04)",
                      }}
                    >
                      <option value="gocardless">Prélèvement automatique (GoCardless)</option>
                    </select>
                  </label>

                  {schedulePayment.paymentMethod === "gocardless" ? (
                    <div style={{ padding: 14, border: "1px solid rgba(0,0,0,0.08)", borderRadius: "var(--radius-sm)", background: "#fff" }}>
                      <div style={{ fontWeight: 800, color: "var(--text)" }}>Prélèvement automatique (GoCardless)</div>
                      <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
                        Les informations ci-dessous seront utilisées pour créer le mandat SEPA.
                        <br />
                        <strong>*</strong> Champs obligatoires pour le prélèvement automatique.
                      </div>

                      <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                            IBAN <span style={{ color: "#b42318" }}>*</span>
                          </span>
                          <input
                            value={schedulePayment.gocardless.iban}
                            onChange={(e) => setSchedulePayment((p) => ({ ...p, gocardless: { ...p.gocardless, iban: e.target.value } }))}
                            placeholder="FR76…"
                            style={{ borderRadius: 12, border: "1px solid var(--border-strong)", padding: "10px 12px", fontSize: 14, outline: "none" }}
                          />
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                            Titulaire du Compte <span style={{ color: "#b42318" }}>*</span>
                          </span>
                          <input
                            value={schedulePayment.gocardless.accountHolder}
                            onChange={(e) => setSchedulePayment((p) => ({ ...p, gocardless: { ...p.gocardless, accountHolder: e.target.value } }))}
                            placeholder="Nom / Prénom"
                            style={{ borderRadius: 12, border: "1px solid var(--border-strong)", padding: "10px 12px", fontSize: 14, outline: "none" }}
                          />
                        </label>

                        <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                            Adresse <span style={{ color: "#b42318" }}>*</span>
                          </span>
                          <input
                            value={schedulePayment.gocardless.address}
                            onChange={(e) => setSchedulePayment((p) => ({ ...p, gocardless: { ...p.gocardless, address: e.target.value } }))}
                            placeholder="Adresse du titulaire"
                            style={{ borderRadius: 12, border: "1px solid var(--border-strong)", padding: "10px 12px", fontSize: 14, outline: "none" }}
                          />
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                            Code Postal <span style={{ color: "#b42318" }}>*</span>
                          </span>
                          <input
                            value={schedulePayment.gocardless.postalCode}
                            onChange={(e) => setSchedulePayment((p) => ({ ...p, gocardless: { ...p.gocardless, postalCode: e.target.value } }))}
                            placeholder="75001"
                            style={{ borderRadius: 12, border: "1px solid var(--border-strong)", padding: "10px 12px", fontSize: 14, outline: "none" }}
                          />
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                            Ville <span style={{ color: "#b42318" }}>*</span>
                          </span>
                          <input
                            value={schedulePayment.gocardless.city}
                            onChange={(e) => setSchedulePayment((p) => ({ ...p, gocardless: { ...p.gocardless, city: e.target.value } }))}
                            placeholder="Paris"
                            style={{ borderRadius: 12, border: "1px solid var(--border-strong)", padding: "10px 12px", fontSize: 14, outline: "none" }}
                          />
                        </label>

                        <label style={{ display: "grid", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                            Pays <span style={{ color: "#b42318" }}>*</span>
                          </span>
                          <input
                            value={schedulePayment.gocardless.country}
                            onChange={(e) => setSchedulePayment((p) => ({ ...p, gocardless: { ...p.gocardless, country: e.target.value } }))}
                            placeholder="France"
                            style={{ borderRadius: 12, border: "1px solid var(--border-strong)", padding: "10px 12px", fontSize: 14, outline: "none" }}
                          />
                        </label>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : step === "details" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg2)" }}>
                <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Détails</div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>
                  Ajoutez les informations utiles (adresse si différente, nombre d’équipements, contraintes d’accès, etc.).
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={5}
                  placeholder="Ex: Je souhaite couvrir 2 unités intérieures, accès par cour, idéalement le matin…"
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid var(--border-strong)",
                    padding: 12,
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: 14,
                    resize: "vertical",
                    outline: "none",
                    background: "#fff",
                  }}
                />
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 14,
                      background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      fontSize: 18,
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    👁
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, color: "var(--text)", fontFamily: "'DM Sans', sans-serif", fontSize: 18 }}>
                      Aperçu du contrat
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                      Vérifiez le rendu final avant l’envoi.
                    </div>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 8, fontSize: 14, color: "var(--text-secondary)" }}>
                  <div><strong style={{ color: "var(--text)" }}>Produit:</strong> {selectedProduct?.name ?? "—"}</div>
                  <div><strong style={{ color: "var(--text)" }}>Formule:</strong> {selectedFormula?.name ?? "—"}</div>
                  <div>
                    <strong style={{ color: "var(--text)" }}>Tarif:</strong>{" "}
                    {estimatedPrice != null ? `${estimatedPrice.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/mois` : "—"}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <strong style={{ color: "var(--text)" }}>Équipement:</strong>
                    <div style={{ marginTop: 6, lineHeight: 1.6 }}>
                      <div>Marque: {equipmentDetails.marque.trim() || "—"}</div>
                      <div>Modèle: {equipmentDetails.modele.trim() || "—"}</div>
                      <div>Date de mise en service: {equipmentDetails.dateMiseEnService || "—"}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <strong style={{ color: "var(--text)" }}>Planification & paiement:</strong>
                    <div style={{ marginTop: 6, lineHeight: 1.6 }}>
                      <div>Date souhaitée: {schedulePayment.desiredStartDate || "—"}</div>
                      <div>Fin de contrat (+1 an): {schedulePayment.contractEndDate || "—"}</div>
                      <div>Fréquence du contrat: Tous les 12 mois</div>
                      <div>
                        Montant:{" "}
                        {`${schedulePayment.monthlyAmount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/mois`}
                      </div>
                      <div>Périodicité: Mensuel · Jour: {schedulePayment.paymentDate}</div>
                      <div>Mode: Prélèvement automatique (GoCardless)</div>
                    </div>
                  </div>
                  {notes.trim() ? (
                    <div style={{ marginTop: 6 }}>
                      <strong style={{ color: "var(--text)" }}>Détails:</strong>
                      <div style={{ marginTop: 6, color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{notes.trim()}</div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div
                ref={previewSectionRef}
                style={{ padding: 14, border: "1px solid rgba(0,0,0,0.08)", borderRadius: "var(--radius-sm)", background: "#fff" }}
              >
                <div style={{ fontWeight: 800, color: "var(--text)", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <span>Prévisualisation PDF</span>
                  {previewGenerating ? <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Génération…</span> : null}
                </div>

                {previewGenerating ? (
                  <div style={{ padding: 18, border: "1px dashed var(--border)", borderRadius: 12, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
                    Le PDF est en cours de création pour vous permettre de vérifier le rendu avant l’envoi.
                  </div>
                ) : previewError ? (
                  <div style={{ padding: 18, border: "1px solid rgba(180,35,24,0.35)", borderRadius: 12, color: "#b42318", fontSize: 13, lineHeight: 1.6 }}>
                    Impossible de générer le PDF : {previewError}
                  </div>
                ) : previewPdfUrl ? (
                  isMobile ? (
                    <a
                      href={previewPdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 10,
                        width: "100%",
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: "1px solid var(--border-strong)",
                        background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                        color: "#fff",
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: 14,
                        fontWeight: 800,
                        textDecoration: "none",
                      }}
                    >
                      Ouvrir le PDF
                    </a>
                  ) : (
                    <iframe
                      src={previewPdfUrl}
                      title="Aperçu contrat"
                      style={{ width: "100%", height: 420, border: "1px solid var(--border)", borderRadius: 12, background: "#fff" }}
                    />
                  )
                ) : (
                  <div style={{ padding: 18, border: "1px dashed var(--border)", borderRadius: 12, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
                    Aucun aperçu disponible.
                  </div>
                )}
              </div>
              <div style={{ padding: 14, border: "1px solid rgba(0,184,220,0.2)", borderRadius: "var(--radius-sm)", background: "rgba(0,184,220,0.06)" }}>
                <div style={{ fontWeight: 700, color: "var(--text)" }}>Ce qui se passe ensuite</div>
                <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
                  Votre contrat est envoyé pour signature. Vous recevrez ensuite le contrat signé dans cette section.
                </div>
              </div>
            </div>
          )}

          {submitError ? (
            <div style={{ marginTop: 12, color: "#b42318", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {submitError}
            </div>
          ) : null}
        </div>

        {/* Actions toujours accessibles (en bas, sans scroll jusqu'au footer) */}
        <div
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 5,
            marginTop: 14,
            paddingTop: 12,
            paddingBottom: 12,
            background: "transparent",
            backdropFilter: "none",
            borderTop: "none",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={step === "formule" ? onClose : back}
              disabled={submitting}
              style={{
                padding: "10px 14px",
                borderRadius: 999,
                background: "transparent",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-strong)",
                cursor: submitting ? "not-allowed" : "pointer",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14,
              }}
            >
              Précédent
            </button>

            {step !== "apercu" ? (
              <button
                type="button"
                onClick={next}
                // Important: si on n'est pas connecté après l'étape équipement, on laisse le bouton
                // cliquable pour ouvrir la modal de connexion.
                disabled={(!canNext && !needsAuthToContinue) || submitting}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                  color: "#fff",
                  border: "none",
                  cursor: (!canNext && !needsAuthToContinue) || submitting ? "not-allowed" : "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 14,
                  fontWeight: 700,
                  opacity: (!canNext && !needsAuthToContinue) || submitting ? 0.7 : 1,
                }}
              >
                Continuer
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!selectedProduct || !selectedFormula || submitting || previewGenerating}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                  color: "#fff",
                  border: "none",
                  cursor: !selectedProduct || !selectedFormula || submitting || previewGenerating ? "not-allowed" : "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 14,
                  fontWeight: 800,
                  opacity: !selectedProduct || !selectedFormula || submitting || previewGenerating ? 0.7 : 1,
                }}
              >
                {submitting ? "Envoi…" : "Souscrire"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

