function resolveBackendBaseUrl(): string {
  const configuredRaw =
    (import.meta.env.VITE_GOCARDLESS_BASE_URL as string | undefined) ||
    (import.meta.env.VITE_API_URL as string | undefined) ||
    "";
  const configured = configuredRaw.trim();
  if (configured) {
    // En LAN, si le front est ouvert sur une IP et la var reste sur localhost,
    // on réécrit vers le même hostname pour éviter "Failed to fetch".
    try {
      if (typeof window !== "undefined") {
        const host = window.location.hostname;
        const proto = window.location.protocol;
        const u = new URL(configured);
        const isLocalhost = u.hostname === "localhost" || u.hostname === "127.0.0.1";
        const isFrontNotLocal = host !== "localhost" && host !== "127.0.0.1";
        if (isLocalhost && isFrontNotLocal) {
          return `${proto}//${host}${u.port ? `:${u.port}` : ""}${u.pathname.replace(/\/$/, "")}`;
        }
      }
    } catch {
      // ignore: fallback below
    }
    return configured.replace(/\/+$/, "");
  }

  // Default: uniquement utilisable en local (dev).
  // En production, VITE_API_URL DOIT être définie dans les variables d'env Netlify.
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
    if (!isLocal) {
      console.error(
        "[Portal][API] VITE_API_URL is not set! " +
        "Add VITE_API_URL=https://your-backend.onrender.com in Netlify environment variables."
      );
      return "__MISSING_API_URL__"; // provoquera une erreur fetch lisible
    }
    return `${window.location.protocol}//${hostname}:3002`;
  }
  return "http://localhost:3002";
}

export const GOCARDLESS_BACKEND_BASE_URL = resolveBackendBaseUrl();

// Debug de déploiement: permet de vérifier quelles variables VITE_* ont été injectées au build Netlify
// et quelle base URL est effectivement utilisée par le portail.
try {
  // eslint-disable-next-line no-console
  console.log("[Portal][API] backend base url resolved", {
    resolved: GOCARDLESS_BACKEND_BASE_URL,
    VITE_GOCARDLESS_BASE_URL: (import.meta.env.VITE_GOCARDLESS_BASE_URL as string | undefined) || "",
    VITE_API_URL: (import.meta.env.VITE_API_URL as string | undefined) || "",
    mode: import.meta.env.MODE,
  });
} catch {
  // ignore (SSR / build edge cases)
}

type SignatureStatus = "pending" | "signed" | "declined" | "expired";

async function readResponseTextSafe(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function createPortalContractAndSendForSignature(args: {
  maintenanceId: string;
  contractNumber: string;
  pdfUrl: string;
  signerEmail: string;
  signerFirstName: string;
  signerLastName: string;
  equipmentName: string;
  contractStartDate: string; // YYYY-MM-DD
  contractEndDate: string; // YYYY-MM-DD
  monthlyAmount: number;
  paymentDate: number; // 1-28
  paymentMethod: "gocardless" | "manual";
  gocardlessIban: string;
  gocardlessAccountHolder: string;
  gocardlessAddress: string;
  gocardlessPostalCode: string;
  gocardlessCity: string;
  gocardlessCountry: string;
}): Promise<{ contractId: string; yousignRequestId: string }> {
  const url = `${GOCARDLESS_BACKEND_BASE_URL}/api/portal/create-contract`;
  const startedAt = Date.now();
  console.log("[Portal][API] POST create-contract", {
    url,
    baseUrl: GOCARDLESS_BACKEND_BASE_URL,
    env: {
      VITE_GOCARDLESS_BASE_URL: (import.meta.env.VITE_GOCARDLESS_BASE_URL as string | undefined) || "",
      VITE_API_URL: (import.meta.env.VITE_API_URL as string | undefined) || "",
      mode: import.meta.env.MODE,
    },
    maintenanceId: args.maintenanceId,
    contractNumber: args.contractNumber,
    paymentMethod: args.paymentMethod,
    monthlyAmount: args.monthlyAmount,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (e) {
    console.error("[Portal][API] create-contract fetch failed", { url, ms: Date.now() - startedAt, error: String(e) });
    throw e;
  }

  if (!res.ok) {
    const txt = await readResponseTextSafe(res);
    console.error("[Portal][API] create-contract non-OK", {
      url,
      status: res.status,
      ms: Date.now() - startedAt,
      body: txt.slice(0, 900),
    });
    throw new Error(`Création contrat impossible (HTTP ${res.status})${txt ? `: ${txt}` : ""}`);
  }

  const data: unknown = await res.json();
  console.log("[Portal][API] create-contract OK", { url, ms: Date.now() - startedAt });
  if (
    typeof data === "object" &&
    data !== null &&
    "contractId" in data &&
    "yousignRequestId" in data &&
    typeof (data as any).contractId === "string" &&
    typeof (data as any).yousignRequestId === "string"
  ) {
    return { contractId: (data as any).contractId, yousignRequestId: (data as any).yousignRequestId };
  }

  throw new Error("Réponse backend invalide (création contrat).");
}

export async function getSignatureStatusFromBackend(args: {
  requestId: string;
}): Promise<{ status: SignatureStatus; signedAt?: string | null }> {
  const url = `${GOCARDLESS_BACKEND_BASE_URL}/api/yousign/status/${encodeURIComponent(args.requestId)}`;
  const startedAt = Date.now();
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const txt = await readResponseTextSafe(res);
    console.warn("[Portal][API] yousign status non-OK", { url, status: res.status, ms: Date.now() - startedAt, body: txt.slice(0, 600) });
    throw new Error(`Statut signature indisponible (HTTP ${res.status})${txt ? `: ${txt}` : ""}`);
  }

  const data: unknown = await res.json();
  const status =
    typeof data === "object" &&
    data !== null &&
    "data" in data &&
    typeof (data as any).data === "object" &&
    (data as any).data !== null &&
    "status" in (data as any).data
      ? ((data as any).data.status as unknown)
      : undefined;

  if (status === "pending" || status === "signed" || status === "declined" || status === "expired") {
    const signedAt =
      typeof (data as any).data?.signed_at === "string" || (data as any).data?.signed_at === null
        ? ((data as any).data.signed_at as string | null)
        : undefined;
    return { status, signedAt };
  }

  throw new Error("Réponse backend invalide (statut signature).");
}

export async function createPortalMaintenanceForContract(args: {
  clientId: string;
  clientName?: string;
  signerEmail: string;
  contractNumber: string;
  contractStartDate: string; // YYYY-MM-DD
  contractEndDate: string; // YYYY-MM-DD
  monthlyAmount: number;
  paymentDate: number;
  paymentMethod: "gocardless" | "manual";
  equipmentName: string;
  gocardlessIban?: string;
  gocardlessAccountHolder?: string;
  gocardlessAddress?: string;
  gocardlessPostalCode?: string;
  gocardlessCity?: string;
  gocardlessCountry?: string;
}): Promise<{ maintenanceId: string }> {
  const url = `${GOCARDLESS_BACKEND_BASE_URL}/api/portal/create-maintenance-for-contract`;
  const startedAt = Date.now();
  console.log("[Portal][API] POST create-maintenance-for-contract", {
    url,
    baseUrl: GOCARDLESS_BACKEND_BASE_URL,
    clientId: args.clientId,
    contractNumber: args.contractNumber,
    paymentMethod: args.paymentMethod,
    monthlyAmount: args.monthlyAmount,
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (e) {
    console.error("[Portal][API] create-maintenance fetch failed", { url, ms: Date.now() - startedAt, error: String(e) });
    throw e;
  }

  if (!res.ok) {
    const txt = await readResponseTextSafe(res);
    console.error("[Portal][API] create-maintenance non-OK", { url, status: res.status, ms: Date.now() - startedAt, body: txt.slice(0, 900) });
    throw new Error(`Création maintenance impossible (HTTP ${res.status})${txt ? `: ${txt}` : ""}`);
  }

  const data: unknown = await res.json();
  console.log("[Portal][API] create-maintenance OK", { url, ms: Date.now() - startedAt });
  if (typeof data === "object" && data !== null && "maintenanceId" in data && typeof (data as any).maintenanceId === "string") {
    return { maintenanceId: (data as any).maintenanceId };
  }

  throw new Error("Réponse backend invalide (création maintenance).");
}

export async function downloadSignedContractFromBackend(args: {
  requestId: string;
  filename: string;
}): Promise<void> {
  const res = await fetch(`${GOCARDLESS_BACKEND_BASE_URL}/api/yousign/download/${encodeURIComponent(args.requestId)}`, {
    method: "GET",
    headers: {
      // backend returns application/pdf
      Accept: "application/pdf",
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Téléchargement impossible (HTTP ${res.status})${txt ? `: ${txt}` : ""}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = args.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function getGoCardlessSubscriptionStatusFromBackend(args: {
  subscriptionId: string;
}): Promise<{ status: string; nextChargeDate?: string | null }> {
  const url = new URL(`${GOCARDLESS_BACKEND_BASE_URL}/api/gocardless/subscription-status`);
  url.searchParams.set("subscriptionId", args.subscriptionId);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Statut abonnement indisponible (HTTP ${res.status})${txt ? `: ${txt}` : ""}`);
  }

  const data: unknown = await res.json();
  if (typeof data === "object" && data !== null && "status" in data && typeof (data as any).status === "string") {
    return {
      status: (data as any).status,
      nextChargeDate:
        typeof (data as any).next_charge_date === "string" || (data as any).next_charge_date === null
          ? ((data as any).next_charge_date as string | null)
          : undefined,
    };
  }
  throw new Error("Réponse backend invalide (statut abonnement).");
}

export type GoCardlessPayment = {
  id: string;
  status?: string;
  amount?: number;
  currency?: string;
  charge_date?: string;
  created_at?: string;
  description?: string;
  links?: { subscription?: string; mandate?: string };
};

export async function getGoCardlessPaymentsBySubscriptionFromBackend(args: {
  subscriptionId: string;
  limit?: number;
}): Promise<{ payments: GoCardlessPayment[] }> {
  const url = new URL(`${GOCARDLESS_BACKEND_BASE_URL}/api/gocardless/payments-by-subscription`);
  url.searchParams.set("subscriptionId", args.subscriptionId);
  if (typeof args.limit === "number") url.searchParams.set("limit", String(args.limit));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Paiements indisponibles (HTTP ${res.status})${txt ? `: ${txt}` : ""}`);
  }

  const data: unknown = await res.json();
  if (typeof data === "object" && data !== null && "payments" in data && Array.isArray((data as any).payments)) {
    return { payments: (data as any).payments as GoCardlessPayment[] };
  }
  throw new Error("Réponse backend invalide (paiements abonnement).");
}