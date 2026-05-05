import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export type ContractSignatureStatus = 'pending' | 'signed';

export interface EquipmentField {
  label: string;
  value?: string;
}

export interface Equipment {
  id: string;
  name: string;
  selected?: boolean;
  price?: number;
  typeId?: string;
  fields?: EquipmentField[];
}

export interface ContractPdfData {
  contractNumber?: string;
  clientName?: string;
  createdAt?: Date | string;

  clientContact?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };

  clientAddress?: {
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  };

  equipment?: Equipment[];

  paymentMethod?: string; // ex: 'gocardless'
  monthlyAmount?: number;

  // GoCardless / SEPA
  gocardlessAccountHolder?: string;
  gocardlessAddress?: string;
  gocardlessCity?: string;
  gocardlessPostalCode?: string;
  gocardlessCountry?: string;
  gocardlessIban?: string;

  // Signature
  signatureStatus?: ContractSignatureStatus;
  signatureDate?: Date | string;
  signatureImageBase64?: string; // data URL ou base64
}

function escapeHtml(s: string): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatEuro(amount: number | undefined): string {
  const n = typeof amount === 'number' && isFinite(amount) ? amount : 0;
  return `${n.toFixed(2).replace('.', ',')} €`;
}

/**
 * Parse une date « métier » sans ambiguïté US : `JJ/MM/AAAA` est toujours jour/mois/année ;
 * `AAAA-MM-JJ` (début de chaîne ISO) est en calendrier local.
 */
function parseContractDateInput(raw: unknown): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === 'object' && raw !== null && typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    try {
      const d = (raw as { toDate: () => Date }).toDate();
      return d && !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && raw !== null && 'seconds' in (raw as object)) {
    const sec = Number((raw as { seconds: unknown }).seconds);
    if (!Number.isFinite(sec)) return null;
    const d = new Date(sec * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(raw).trim();
  if (!s) return null;

  const isoStart = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoStart) {
    const y = Number(isoStart[1]);
    const m = Number(isoStart[2]);
    const da = Number(isoStart[3]);
    const d = new Date(y, m - 1, da);
    if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== da) return null;
    return d;
  }

  const frSlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (frSlash) {
    const da = Number(frSlash[1]);
    const mo = Number(frSlash[2]);
    const y = Number(frSlash[3]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    const d = new Date(y, mo - 1, da);
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d;
  }

  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Affichage calendaire français strict JJ/MM/AAAA. */
function formatDateFr(raw: unknown): string {
  const d = parseContractDateInput(raw);
  if (!d) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear());
  return `${day}/${month}/${year}`;
}

/** Date de la ligne « Le : » (signature) : jour connu en JJ/MM/AAAA, sans onglet DocuSign (format US côté compte). */
function formatPdfSignatureLineDate(data: ContractPdfData): string {
  return formatDateFr(data.signatureDate ?? data.createdAt);
}

/** Adresse complète pour les mentions « Fait à : » (rue, CP ville, pays si présent). */
function formatClientFullAddressForContract(data: ContractPdfData): string {
  const street = (data.clientAddress?.street || data.gocardlessAddress || '').trim();
  const pc = (data.clientAddress?.postalCode || data.gocardlessPostalCode || '').trim();
  const city = (data.clientAddress?.city || data.gocardlessCity || '').trim();
  const cpCity = [pc, city].filter(Boolean).join(' ');
  const country = (data.clientAddress?.country || data.gocardlessCountry || '').trim();
  return [street, cpCity, country].filter((p) => p.length > 0).join(', ');
}

/** Bloc commun pages 3 / 4 / 5 : Fait à + Le + zone signature (référence visuelle = page 4). */
function renderPdfFaitALeSignatureRowHtml(
  data: ContractPdfData,
  options: {
    signatureAnchor: 'DS_SIGNATURE_CLIENT' | 'DS_SIGNATURE_SEPA' | 'DS_SIGNATURE_RETRACTATION';
    rightCaptionHtml: string;
    signatureImg: string | null;
    /** Si l’adresse structurée est vide (ex. page 5), afficher cette chaîne à la place. */
    addressFallback?: string;
  }
): string {
  const faitARaw = formatClientFullAddressForContract(data);
  const faitA = faitARaw || (options.addressFallback || '').trim();
  const leDate = formatPdfSignatureLineDate(data);

  return `
    <div class="sig-row">
      <div class="sig-left">
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;margin-bottom:8px;font-size:8pt;color:#1a1a1a">
          <span style="font-weight:700;color:#1a1a1a;white-space:nowrap">Fait à :</span>
          <span style="flex:1;min-width:0;color:#1a1a1a;font-weight:500">${
            faitA
              ? escapeHtml(faitA)
              : `<span style="color:#888;font-style:italic;font-weight:400">→ Adresse à compléter</span>`
          }</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;font-size:8pt;color:#1a1a1a">
          <span style="font-weight:700;color:#1a1a1a;white-space:nowrap">Le :</span>
          <span style="display:inline-flex;align-items:center;min-height:16px;min-width:160px;flex:1;color:#1a1a1a;font-weight:500">
            ${
              leDate
                ? escapeHtml(leDate)
                : `<span style="color:#888;font-style:italic;font-weight:400">→ Date à compléter</span>`
            }
          </span>
        </div>
      </div>
      <div class="sig-right">
        <div class="sig-line-box" style="width:240px">
          <span style="position:absolute;left:8px;bottom:10px;font-size:1px;line-height:1px;color:rgba(0,0,0,0.04);white-space:nowrap">${options.signatureAnchor}</span>
          ${
            options.signatureImg
              ? `<img src="${options.signatureImg}" alt="Signature" style="position:relative;z-index:1;max-width:210px;max-height:44px;object-fit:contain;display:block" />`
              : ''
          }
        </div>
        <div class="sig-caption">${options.rightCaptionHtml}</div>
      </div>
    </div>
  `;
}

function normalizeSignatureDataUrl(signatureImageBase64: string | undefined): string | null {
  if (!signatureImageBase64) return null;
  const s = signatureImageBase64.trim();
  if (!s) return null;
  if (s.startsWith('data:image/')) return s;
  return `data:image/png;base64,${s}`;
}

const TARIFS_MAP: Record<string, { std: number; prem: number; vip: number }> = {
  'PAC air/eau ou air/air': { std: 19.9, prem: 24.9, vip: 34.9 },
  'Chauffe-eau thermodynamique': { std: 9.9, prem: 14.9, vip: 19.9 },
  'Chauffe-eau solaire (CESI)': { std: 12.9, prem: 19.9, vip: 24.9 },
  'Poêle à granulés': { std: 12.9, prem: 19.9, vip: 24.9 },
  'Chaudière à granulés': { std: 24.9, prem: 34.9, vip: 39.9 },
  'Système solaire combiné (SSC)': { std: 24.9, prem: 34.9, vip: 39.9 },
};

function equipmentTypeLabelFromTypeId(typeId?: string): string {
  const tid = (typeId || '').toLowerCase();
  if (!tid) return '';
  if (tid === 'pac' || tid.includes('pac') || tid.includes('pompe-air')) return 'PAC air/eau ou air/air';
  if (tid === 'be' || tid === 'btd' || tid.includes('thermo') || tid.includes('electrique')) return 'Chauffe-eau thermodynamique';
  if (tid === 'bs' || tid.includes('solaire') || tid.includes('cesi')) return 'Chauffe-eau solaire (CESI)';
  if (tid === 'poele' || tid.includes('poele')) return 'Poêle à granulés';
  if (tid === 'chaudiere' || tid.includes('chaudiere')) return 'Chaudière à granulés';
  if (tid === 'ssc' || tid.includes('systeme-solaire') || tid.includes('combin')) return 'Système solaire combiné (SSC)';
  return '';
}

function equipmentTypeLabel(e: Equipment): string {
  return equipmentTypeLabelFromTypeId(e.typeId) || e.name || '';
}

function inferFormulaByPrice(typeLabel: string, price?: number): 'std' | 'prem' | 'vip' | '' {
  const map = TARIFS_MAP[typeLabel];
  if (!map || typeof price !== 'number') return '';
  const eps = 0.05;
  const byValue = (key: 'std' | 'prem' | 'vip') => Math.abs(map[key] - price) <= eps;
  if (byValue('std')) return 'std';
  if (byValue('prem')) return 'prem';
  if (byValue('vip')) return 'vip';
  return '';
}

function extractField(e: Equipment, labelStartsWith: string): string {
  const key = labelStartsWith.toLowerCase();
  const f = (e.fields || []).find((x) => (x.label || '').toLowerCase().startsWith(key));
  return (f?.value || '').trim();
}

function getEquipmentsForContract(data: ContractPdfData): Equipment[] {
  return (data.equipment || []).filter((e) => e.selected !== false);
}

function calcTotalMonthly(data: ContractPdfData): number {
  const eqs = getEquipmentsForContract(data);
  const sum = eqs.reduce((acc, e) => acc + (typeof e.price === 'number' ? e.price : 0), 0);
  if (sum > 0) return sum;
  return typeof data.monthlyAmount === 'number' ? data.monthlyAmount : 0;
}

/* ─── CSS (ta maquette) ─────────────────────────────────────────── */
const CONTRACT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap');
*{box-sizing:border-box;margin:0;padding:0}

.page{
  width:794px;
  height:1123px;
  background:#fff;
  overflow:hidden;
  display:flex;
  flex-direction:column;
}

/* HEADER PAGE 1 */
.hdr{background:#fff;}
.hdr-top{padding:10px 0 8px;text-align:center;}
.hdr-logo-img{height:34px;width:auto;display:block;margin:0 auto;object-fit:contain;}
.hdr-band{background:#0D2B3E;padding:14px 32px 12px;text-align:center;margin:0 32px;}
.hdr-title{font-size:15pt;font-weight:700;color:#fff;letter-spacing:.5px;margin:2px 0 6px;}
.hdr-sub{color:rgba(255,255,255,.72);font-size:8pt;}
.hdr-sub-italic{font-style:italic;}
.hdr-sub-small{font-size:7.3pt;color:rgba(255,255,255,.6);margin-top:2px;}

/* HEADER PAGES 2-5 */
.pg-hdr{display:flex;align-items:center;padding:10px 28px 8px;border-bottom:2px solid #00AEEF;gap:16px;}
.pg-hdr-left{display:flex;flex-direction:column;gap:2px;}
.pg-hdr-logo-img{height:22px;width:auto;display:block;object-fit:contain;}
.pg-hdr-tagline{font-size:6.5pt;color:#888;font-style:italic;margin-top:0;}
.pg-hdr-info{margin-left:auto;font-size:7pt;color:#888;text-align:right;}

/* flex-shrink: 0 évite que le corps soit écrasé quand la page a d’autres blocs sous .body (ex. p.5 légal + footer) — sinon la signature en bas est coupée par overflow:hidden */
.body{padding:20px 32px 24px;flex:1 0 auto;}

/* SECTION TITLE */
.sec-title{font-size:11pt;font-weight:700;color:#0D2B3E;border-left:3px solid #00AEEF;padding-left:9px;margin-bottom:7px;margin-top:18px;}
.sec-title:first-child{margin-top:0;}

/* SUB LABEL */
.sub-lbl{font-size:8pt;font-weight:700;color:#00AEEF;margin:10px 0 4px;text-transform:uppercase;letter-spacing:.5px;}

/* PRESTATAIRE */
.prest{font-size:8pt;color:#333;line-height:1.55;margin-bottom:8px;}
.prest strong{font-weight:700;}

/* CLIENT TABLE */
.ct{width:100%;border-collapse:collapse;margin-bottom:10px;}
.ct td{border:1px solid #c8d4da;padding:4px 8px;font-size:8pt;vertical-align:middle;}
.ct .lbl{font-weight:700;color:#0D2B3E;background:#f5f8fa;white-space:nowrap;width:110px;}
.ct .val{background:#fffdf0;}
.auto{color:#888;font-style:italic;}

/* EQUIPMENT */
.eq-wrap{display:flex;border:1px solid #c8d4da;margin-bottom:10px;}
.eq-col{flex:1;border-right:1px solid #c8d4da;}
.eq-col:last-child{border-right:none;}
.eq-head{background:#0D2B3E;color:#fff;font-size:8pt;font-weight:700;padding:6px 8px;text-align:center;}
.eq-head.opt{background:#f5f8fa;color:#0D2B3E;font-style:italic;}
.eq-row{display:flex;border-bottom:1px solid #e8edf0;}
.eq-row:last-child{border-bottom:none;}
.eq-lbl{font-size:7.5pt;font-weight:700;color:#0D2B3E;background:#f5f8fa;padding:4px 5px;width:72px;min-width:72px;border-right:1px solid #e8edf0;line-height:1.35;}
.eq-val{flex:1;padding:3px 5px;background:#fffdf0;font-size:7.5pt;color:#888;font-style:italic;}
.f-btns{display:flex;gap:3px;padding:3px 4px;background:#fffdf0;}
.fb{padding:2px 6px;font-size:7pt;font-weight:700;border:1px solid #c8d4da;border-radius:2px;background:#fff;color:#555;font-family:inherit;}
.fb.s-std{background:#0D2B3E;color:#fff;border-color:#0D2B3E;}
.fb.s-prem{background:#00AEEF;color:#fff;border-color:#00AEEF;}
.fb.s-vip{background:#1FA898;color:#fff;border-color:#1FA898;}

/* RECAP */
.recap{display:flex;border:1px solid #c8d4da;}
.recap-t{flex:1;}
.recap-t table{width:100%;border-collapse:collapse;}
.recap-t td{border:1px solid #c8d4da;padding:5px 10px;font-size:8pt;}
.recap-t .rl{font-weight:700;background:#f5f8fa;color:#0D2B3E;width:130px;}
.recap-t .rv{background:#fffdf0;color:#888;font-style:italic;}
.recap-r{width:250px;background:#E8F7F5;border-left:1px solid #c8d4da;padding:8px 12px;font-size:7.5pt;line-height:1.55;color:#0D2B3E;}
.total-v{color:#0D2B3E;font-style:normal;font-weight:700;}

/* FORMULE TABLE */
.ftbl{width:100%;border-collapse:collapse;font-size:8pt;margin-bottom:6px;}
.ftbl th{padding:7px 6px;text-align:center;font-weight:700;border:1px solid #c8d4da;}
.ftbl th.blank{background:#fff;border-color:transparent;}
.ftbl th.std{background:#f5f8fa;color:#0D2B3E;font-size:9pt;}
.ftbl th.prem{background:#00AEEF;color:#fff;font-size:9pt;}
.ftbl th.vip{background:#1FA898;color:#fff;font-size:9pt;}
.ftbl th .sp{font-size:7.5pt;font-weight:400;display:block;margin-top:1px;}
.ftbl td{padding:5px 8px;border:1px solid #dde4e8;text-align:center;}
.ftbl td.feat{text-align:left;color:#0D2B3E;}
.ftbl tr:nth-child(odd) td{background:#fafbfc;}
.ftbl tr:nth-child(even) td{background:#fff;}
.chk{color:#0D2B3E;font-size:11pt;}
.dsh{color:#bbb;}
.fnote{font-size:7pt;color:#666;font-style:italic;margin-top:4px;}
.teal-lbl{font-size:8pt;font-weight:700;color:#1FA898;margin:14px 0 4px;}

/* TARIF TABLE */
.ttbl{width:100%;border-collapse:collapse;font-size:8pt;}
.ttbl th{padding:7px 10px;border:1px solid #c8d4da;text-align:center;font-weight:700;}
.ttbl th.fl{text-align:left;background:#f5f8fa;color:#0D2B3E;}
.ttbl th.ts{background:#f5f8fa;color:#0D2B3E;}
.ttbl th.tp{background:#00AEEF;color:#fff;}
.ttbl th.tv{background:#1FA898;color:#fff;}
.ttbl td{padding:7px 10px;border:1px solid #dde4e8;}
.ttbl td.feat{font-weight:500;color:#0D2B3E;}
.ttbl td.ps{text-align:center;font-weight:700;color:#0D2B3E;}
.ttbl td.pp{text-align:center;font-weight:700;color:#00AEEF;}
.ttbl td.pv{text-align:center;font-weight:700;color:#1FA898;}
.ttbl tr:nth-child(odd) td{background:#fafbfc;}
.ttbl tr:nth-child(even) td{background:#fff;}

/* RESIL TABLE */
.rtbl{width:100%;border-collapse:collapse;font-size:8pt;margin-bottom:10px;}
.rtbl td{border:1px solid #c8d4da;padding:6px 10px;}
.rtbl td.k{font-weight:700;color:#fff;width:100px;white-space:nowrap;text-align:center;}
.k-ech{background:#6B7C85;}.k-av6{background:#6B7C85;}.k-ap6{background:#1FA898;}.k-vente{background:#00AEEF;}
.retract-box{background:#f0faff;border:1px solid #c8e8f5;border-radius:3px;padding:8px 12px;font-size:8pt;color:#0D2B3E;margin-top:8px;line-height:1.55;}

/* TWO COL */
.two-col{display:flex;gap:22px;}
.two-col .col{flex:1;}

/* DELAY TABLE */
.dtbl{width:100%;border-collapse:collapse;font-size:8pt;margin-bottom:8px;}
.dtbl th{background:#0D2B3E;color:#fff;padding:5px 7px;font-size:7.5pt;text-align:center;border:1px solid #0D2B3E;}
.dtbl th:first-child{text-align:left;}
.dtbl td{border:1px solid #dde4e8;padding:4px 7px;text-align:center;}
.dtbl td:first-child{text-align:left;}
.vc{color:#1FA898;font-weight:700;}.pc{color:#00AEEF;font-weight:700;}

/* ZONE TABLE */
.ztbl{width:100%;border-collapse:collapse;font-size:8pt;margin-bottom:6px;}
.ztbl th{background:#0D2B3E;color:#fff;padding:5px 8px;border:1px solid #0D2B3E;}
.ztbl td{border:1px solid #dde4e8;padding:5px 8px;}
.ztbl td.zk{background:#E8F7F5;font-weight:700;color:#1FA898;}
.ztbl td.zp{font-weight:700;text-align:right;}

/* EXCL */
.excl-h{font-size:8pt;font-weight:700;color:#e05c2a;margin-bottom:4px;}
.excl-list{list-style:none;padding:0;}
.excl-list li{padding:4px 0 4px 14px;position:relative;font-size:7.5pt;border-bottom:1px solid #eee;line-height:1.4;}
.excl-list li::before{content:'—';position:absolute;left:0;color:#00AEEF;}
.excl-list li:last-child{border-bottom:none;}

/* ARTS */
.at{font-size:9.5pt;font-weight:700;color:#00AEEF;margin:12px 0 4px;}
.ab{font-size:8pt;line-height:1.6;color:#1a1a1a;margin-bottom:6px;}
.dl{list-style:none;padding:0;}
.dl li{font-size:8pt;line-height:1.5;padding:2px 0 2px 14px;position:relative;}
.dl li::before{content:'—';position:absolute;left:0;color:#555;}
.abuse-box{background:#f5f8fa;border:1px solid #dde4e8;padding:8px 12px;font-size:7.5pt;color:#555;font-style:italic;margin-bottom:12px;}
.med-box{background:#E8F7F5;padding:6px 12px;font-size:8pt;color:#0D2B3E;margin-top:4px;border-radius:2px;}

/* SEPA */
.stbl{width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:10px;}
.stbl td{border:1px solid #c8d4da;padding:6px 10px;vertical-align:middle;}
.stbl td.sk{background:#f5f8fa;font-weight:700;color:#0D2B3E;width:190px;}
.stbl td.sv{background:#fffdf0;}
.stbl td.sv .sg{color:#1FA898;font-style:italic;}
.sepa-note{font-size:7.5pt;color:#555;font-style:italic;line-height:1.6;margin-bottom:12px;}

/* SIG ROW — align-top pour que « Fait à / Le » restent sur la même baseline que les données */
.sig-row{display:flex;justify-content:space-between;align-items:flex-start;margin-top:20px;gap:16px;}
.sig-left{font-size:8pt;color:#1a1a1a;line-height:1.55;flex:1;min-width:0;}
.sig-right{text-align:center;flex-shrink:0;}
.sig-line-box{border-bottom:1.5px solid #00AEEF;width:220px;min-height:44px;margin-bottom:4px;position:relative;display:flex;align-items:flex-end;justify-content:center;padding:6px 4px 2px;box-sizing:border-box;}
.sig-caption{font-size:7.5pt;color:#888;font-style:italic;}

/* RETRACT TABLE */
.rftbl{width:100%;border-collapse:collapse;font-size:8.5pt;margin:12px 0;}
.rftbl td{border:1px solid #c8d4da;padding:6px 10px;}
.rftbl td.rk{background:#f5f8fa;font-weight:700;color:#0D2B3E;width:160px;}
.rftbl td.rv{background:#fffdf0;}

/* FOOTER */
.pg-footer{border-top:1px solid #dde4e8;padding:6px 32px;font-size:6.5pt;color:#888;text-align:center;}
`.replace(/\\n\\s+/g, '\n');

function renderPgHdr(): string {
  return `
    <div class="pg-hdr">
      <div class="pg-hdr-left">
        <img class="pg-hdr-logo-img" src="/Logo_Label_Energie-removebg-preview.png" alt="Label Energie" />
        <div class="pg-hdr-tagline">L'énergie au sens propre</div>
      </div>
      <div class="pg-hdr-info">Contrat d'Entretien Annuel · 01 81 72 39 59 · sav@labelenergie.fr</div>
    </div>
  `;
}

function renderPgFooter(n: number): string {
  return `<div class="pg-footer">LABEL ENERGIE SAS · 3 allée du 1er Mai, 77183 Croissy-Beaubourg · SIREN 890 462 625 · v. 2026 · Page ${n} /</div>`;
}

function renderEqCol(e: Equipment | null, n: number): string {
  const typeLabel = e ? equipmentTypeLabel(e) : '';
  const brandModel = e ? (extractField(e, 'Marque') || extractField(e, 'Modèle') || '') : '';
  const serial = e ? (extractField(e, 'N°') || extractField(e, 'N° de série') || extractField(e, 'N° Série') || '') : '';
  const date = e ? (extractField(e, 'Date') || extractField(e, "Date d") || '') : '';
  const formula = e ? inferFormulaByPrice(typeLabel, e.price) : '';

  const formulaButtons = (['std', 'prem', 'vip'] as const)
    .map((f) => {
      const cls = formula === f ? `fb s-${f}` : 'fb';
      return `<span class="${cls}">${f.toUpperCase()}</span>`;
    })
    .join('');

  const price =
    e && typeof e.price === 'number'
      ? `${e.price.toFixed(2).replace('.', ',')} €`
      : typeLabel && formula && TARIFS_MAP[typeLabel]
        ? `${TARIFS_MAP[typeLabel][formula].toFixed(2).replace('.', ',')} €`
        : '';

  const valOrPh = (v: string, ph: string) => (v ? escapeHtml(v) : `<span class="auto">${escapeHtml(ph)}</span>`);

  return `
    <div class="eq-col">
      <div class="eq-head">Équipement ${n}</div>
      <div class="eq-row"><div class="eq-lbl">Type</div><div class="eq-val">${valOrPh(typeLabel, '→ Champ à compléter')}</div></div>
      <div class="eq-row"><div class="eq-lbl">Marque / Modèle</div><div class="eq-val">${valOrPh(brandModel, '→ Champ à compléter')}</div></div>
      <div class="eq-row"><div class="eq-lbl">N° de série</div><div class="eq-val">${valOrPh(serial, '→ Champ à compléter')}</div></div>
      <div class="eq-row"><div class="eq-lbl">Date d'installation</div><div class="eq-val">${valOrPh(date, '→ Champ à compléter')}</div></div>
      <div class="eq-row"><div class="eq-lbl">Formule</div><div class="eq-val" style="padding:0"><div class="f-btns">${formulaButtons}</div></div></div>
      <div class="eq-row"><div class="eq-lbl">Tarif mensuel TTC</div><div class="eq-val">${
        price ? `<span class="total-v" style="font-style:normal">${escapeHtml(price)}</span>` : `<span class="auto">→ À compléter</span>`
      }</div></div>
    </div>
  `;
}

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>${CONTRACT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function getPage1Html(data: ContractPdfData): string {
  const selected = getEquipmentsForContract(data);
  const eqs = selected.slice(0, 3);
  const eqsToRender: Array<Equipment | null> = eqs.length ? eqs : [null];

  const contractNumber = data.contractNumber || '';
  const clientName =
    data.clientName ||
    (data.clientContact?.firstName || data.clientContact?.lastName
      ? `${data.clientContact?.firstName || ''} ${data.clientContact?.lastName || ''}`.trim()
      : '');

  const street = data.clientAddress?.street || data.gocardlessAddress || '';
  const postal = data.clientAddress?.postalCode || data.gocardlessPostalCode || '';
  const city = data.clientAddress?.city || data.gocardlessCity || '';
  const phone = data.clientContact?.phone || '';
  const email = data.clientContact?.email || '';

  const total = calcTotalMonthly(data);

  return wrapHtml(
    'Contrat Label Energie — Page 1',
    `
<div class="page">
  <div class="hdr">
    <div class="hdr-top">
      <img class="hdr-logo-img" src="/Logo_Label_Energie-removebg-preview.png" alt="Label Energie" />
    </div>
    <div class="hdr-band">
      <div class="hdr-title">CONTRAT D'ENTRETIEN ANNUEL</div>
      <div class="hdr-sub hdr-sub-italic">Maintenance préventive · Dépannage prioritaire · Assistance dédiée</div>
      <div class="hdr-sub hdr-sub-small">PAC- Ballons - CESI - SSC - Poêles &amp; Chaudières - v. 1er avril 2026</div>
    </div>
  </div>

  <div class="body">
    <div class="sec-title">Article 1 — Identification des parties</div>

    <div class="sub-lbl">Prestataire</div>
    <p class="prest">
      <strong>LABEL ENERGIE SAS</strong> — SIREN 890 462 625 · 3 allée du 1er Mai, 77183 Croissy-Beaubourg · 01 81 72 39 59 · sav@labelenergie.fr · RGE QualiPAC · QualiSOL · QualiBOIS · QualiPV · Assuré MIC Insurance n°LUN2601434
    </p>

    <div class="sub-lbl">Client</div>
    <table class="ct">
      <tbody>
        <tr>
          <td class="lbl">N° de contrat</td>
          <td class="val">${contractNumber ? escapeHtml(contractNumber) : `<span class="auto">→ Généré automatiquement</span>`}</td>
          <td class="lbl">Adresse</td>
          <td class="val">${street ? escapeHtml(street) : `<span class="auto">→ Champ à compléter</span>`}</td>
          <td class="lbl">Téléphone</td>
          <td class="val">${phone ? escapeHtml(phone) : `<span class="auto">→ Champ à compléter</span>`}</td>
        </tr>
        <tr>
          <td class="lbl">Nom / Prénom</td>
          <td class="val">${clientName ? escapeHtml(clientName) : `<span class="auto">→ Champ à compléter</span>`}</td>
          <td class="lbl">Code postal / Ville</td>
          <td class="val">${
            postal || city
              ? `${escapeHtml(postal)}${postal && city ? ' / ' : ''}${escapeHtml(city)}`
              : `<span class="auto">→ Champ à compléter</span>`
          }</td>
          <td class="lbl">Email</td>
          <td class="val">${email ? escapeHtml(email) : `<span class="auto">→ Champ à compléter</span>`}</td>
        </tr>
      </tbody>
    </table>

    <div class="sub-lbl">Équipements concernés</div>
    <div class="eq-wrap">
      ${eqsToRender.map((e, i) => renderEqCol(e, i + 1)).join('')}
    </div>

    <div class="recap">
      <div class="recap-t">
        <table>
          <tbody>
            <tr>
              <td class="rl">TOTAL mensuel TTC</td>
              <td class="rv">
                ${
                  total > 0 ? `<span class="total-v">${escapeHtml(formatEuro(total))}</span>` : `→ Somme des équipements couverts`
                }
              </td>
            </tr>
            <tr>
              <td class="rl">Mode de paiement</td>
              <td style="background:#fff;padding:5px 10px;font-size:8pt">Prélèvement SEPA mensuel automatique</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="recap-r">
        <strong>Diagnostic de départ inclus</strong><br/>
        À la souscription, notre technicien réalise un état des lieux complet de votre équipement. Tout désordre préexistant ne peut nous être imputé.
      </div>
    </div>

    <div class="sec-title" style="margin-top:18px">Article 2 — Formule choisie</div>
    <table class="ftbl">
      <thead>
        <tr>
          <th class="blank" style="width:36%"></th>
          <th class="std">STANDARD<span class="sp">À partir de 9,90 €/mois</span></th>
          <th class="prem">PREMIUM<span class="sp">À partir de 14,90 €/mois</span></th>
          <th class="vip">VIP<span class="sp">À partir de 19,90 €/mois</span></th>
        </tr>
      </thead>
      <tbody>
        <tr><td class="feat">Visite préventive annuelle + attestation</td><td><span class="chk">✓</span></td><td><span class="chk">✓</span></td><td><span class="chk">✓</span></td></tr>
        <tr><td class="feat">Compte-rendu d'intervention signé</td><td><span class="chk">✓</span></td><td><span class="chk">✓</span></td><td><span class="chk">✓</span></td></tr>
        <tr><td class="feat">Hotline dédiée — 01 81 72 39 59</td><td><span class="chk">✓</span></td><td><span class="chk">✓</span></td><td><span class="chk">✓</span></td></tr>
        <tr><td class="feat">Interventions dépannage incluses / an</td><td>2</td><td>3</td><td>Illimitées*</td></tr>
        <tr><td class="feat">Délai d'intervention prioritaire</td><td>5 j. ouvrés</td><td>4 j. ouvrés</td><td>3 j. ouvrés</td></tr>
        <tr><td class="feat">Réduction pièces de rechange</td><td><span class="dsh">—</span></td><td>10 %</td><td>30 %</td></tr>
        <tr><td class="feat">Main-d'œuvre dépannage incluse</td><td><span class="dsh">—</span></td><td><span class="dsh">—</span></td><td><span class="chk">✓</span></td></tr>
      </tbody>
    </table>
    <p class="fnote">* Illimitées dans la limite d'un usage normal. Délais en jours ouvrés hors week-ends et jours fériés. Joints fibre inclus. Toute autre pièce sur devis.</p>
    <div class="teal-lbl">Tarifs mensuels TTC par équipement</div>
  </div>

  ${renderPgFooter(1)}
</div>
`
  );
}

function getPage2Html(): string {
  const rows = Object.entries(TARIFS_MAP)
    .map(([k, v]) => {
      return `<tr>
        <td class="feat">${escapeHtml(k)}</td>
        <td class="ps">${escapeHtml(formatEuro(v.std))}</td>
        <td class="pp">${escapeHtml(formatEuro(v.prem))}</td>
        <td class="pv">${escapeHtml(formatEuro(v.vip))}</td>
      </tr>`;
    })
    .join('');

  return wrapHtml(
    'Contrat Label Energie — Page 2',
    `
<div class="page">
  ${renderPgHdr()}
  <div class="body">
    <table class="ttbl">
      <thead>
        <tr>
          <th class="fl" style="width:38%">Équipement</th>
          <th class="ts">STANDARD</th>
          <th class="tp">PREMIUM</th>
          <th class="tv">VIP</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="sec-title">Article 3 — Durée, reconduction et résiliation</div>
    <p class="ab">Contrat d'une durée d'un (1) an à compter de la signature, tacite reconduction annuelle. Tarif garanti sans augmentation la 1re année. Révision annuelle à partir de la 2e année : BT01 (40 %) + IPC (30 %) + pièces (30 %) — notification 30 jours avant l'échéance.</p>
    <table class="rtbl">
      <tbody>
        <tr><td class="k k-ech">À l'échéance</td><td>LRAR au moins 2 mois avant l'échéance annuelle.</td></tr>
        <tr><td class="k k-av6">Avant 6 mois</td><td>1 mensualité retenue — reste remboursé au prorata.</td></tr>
        <tr><td class="k k-ap6">Après 6 mois</td><td>Résiliation gratuite, préavis 30 jours, sans pénalité.</td></tr>
        <tr><td class="k k-vente">Vente du bien</td><td>Transfert possible (accord écrit) ou résiliation sans frais.</td></tr>
      </tbody>
    </table>
    <div class="retract-box">Droit de rétractation — 14 jours calendaires à compter de la signature pour vous rétracter sans justification ni pénalité. Formulaire joint en dernière page du présent contrat.</div>

    <div class="sec-title">Article 4 — Prestations incluses et conditions d'intervention</div>
    <div class="two-col">
      <div class="col">
        <div class="at" style="margin-top:0">La visite préventive annuelle</div>
        <p class="ab">Contrôle général, nettoyage des filtres et échangeurs accessibles, vérification des pressions et niveaux de fluides, mesures de performance, contrôle des sécurités électriques, délivrance d'une attestation officielle d'entretien.</p>
        <div class="at">Délais d'intervention SAV</div>
        <table class="dtbl">
          <thead><tr><th>Demande</th><th>Gar.</th><th>VIP</th><th>Prem.</th><th>Std.</th></tr></thead>
          <tbody>
            <tr><td>Chauffage hiver</td><td>15 j.</td><td class="vc">3 j.</td><td class="pc">4 j.</td><td>5 j.</td></tr>
            <tr><td>Eau chaude sanit.</td><td>15 j.</td><td class="vc">3 j.</td><td class="pc">4 j.</td><td>5 j.</td></tr>
            <tr><td>Dysf. partiel</td><td>15 j.</td><td class="vc">3 j.</td><td class="pc">4 j.</td><td>5 j.</td></tr>
            <tr><td>Entretien planifié</td><td>RDV</td><td class="vc">Prio.</td><td class="pc">Prio.</td><td>Prio.</td></tr>
          </tbody>
        </table>
        <p class="fnote">Délais en jours ouvrés hors week-ends et jours fériés.</p>
      </div>
      <div class="col">
        <div class="at" style="margin-top:0">Forfaits de déplacement hors garantie</div>
        <table class="ztbl">
          <thead><tr><th>Zone</th><th>Distance</th><th>Forfait TTC</th></tr></thead>
          <tbody>
            <tr><td class="zk">Zone 1</td><td>≤ 200 km</td><td class="zp">249 €</td></tr>
            <tr><td class="zk">Zone 2</td><td>200–500 km</td><td class="zp">299 €</td></tr>
            <tr><td class="zk">Zone 3</td><td>≥ 500 km</td><td class="zp">359 €</td></tr>
          </tbody>
        </table>
        <p class="fnote">Devis obligatoire &gt; 150 € TTC. Acompte 30 %. Rejet prélèvement : 15 € TTC.</p>
        <div class="excl-h">Exclusions (toutes formules)</div>
        <ul class="excl-list">
          <li>Pièces de rechange — sauf joints fibre courants (devis séparé + accord préalable).</li>
          <li>Ramonage des conduits — obligatoire annuellement, à la charge du Client.</li>
          <li>Recharges en fluide frigorigène — devis + attestation CERFA F-Gaz obligatoire.</li>
          <li>Dommages résultant d'accidents, surtensions, inondations, incendie.</li>
          <li>Intervention préalable d'un tiers non mandaté — suspension immédiate des garanties.</li>
        </ul>
      </div>
    </div>

    <div class="at">Article 5 — Obligations du Client</div>
    <ul class="dl">
      <li>Donner accès à l'équipement lors de chaque intervention — prévenir 48h avant si empêchement.</li>
      <li>Signaler toute panne par écrit à sav@labelenergie.fr avec description et photos.</li>
      <li>Ne pas faire intervenir un tiers sans accord écrit préalable de LABEL ENERGIE.</li>
      <li>Utiliser les équipements conformément aux recommandations du fabricant.</li>
      <li>Assurer la ventilation des locaux à combustion — ne jamais obstruer les arrivées d'air.</li>
      <li>Maintenir le hors-gel dans son logement en toutes circonstances.</li>
      <li>Informer LABEL ENERGIE de toute présence d'amiante avant intervention.</li>
      <li>Régler les cotisations aux échéances contractuelles.</li>
    </ul>

    <div class="at">Article 6 — Clause anti-abus SAV</div>
    <p class="ab">Constituent un usage abusif, justifiant facturation au tarif en vigueur :</p>
    <ul class="dl">
      <li>Problèmes résolus par simple action utilisateur après guidage hotline.</li>
      <li>Réglages de confort pur (température, horaires) sans dysfonctionnement réel.</li>
      <li>Demandes répétées sur un équipement constaté fonctionnel.</li>
      <li>Incompréhension d'utilisation au-delà de la formation initiale.</li>
    </ul>
  </div>
  ${renderPgFooter(2)}
</div>
`
  );
}

function getPage3Html(data: ContractPdfData): string {
  const signatureImg = normalizeSignatureDataUrl(data.signatureImageBase64);

  return wrapHtml(
    'Contrat Label Energie — Page 3',
    `
<div class="page">
  ${renderPgHdr()}
  <div class="body">
    <div class="abuse-box">Usage abusif constaté — après information écrite : facturation déplacement 299 € TTC + formation complémentaire proposée.</div>

    <div class="at">Article 7 — Paiement</div>
    <p class="ab">Prélèvement SEPA mensuel automatique. Tarif garanti sans augmentation la 1re année. Révision annuelle indexée à partir de la 2e année — notification 30 jours avant. Rejet de prélèvement : 15 € TTC, régularisation sous 7 jours.</p>

    <div class="at">Article 8 — Suspension et résiliation</div>
    <p class="ab">Impayé persistant après mise en demeure 8 jours → suspension des interventions et garanties commerciales. Les garanties légales obligatoires (conformité, vices cachés, décennale) restent en vigueur quelles que soient les circonstances.</p>

    <div class="at">Article 9 — Protection des données personnelles</div>
    <p class="ab">Données traitées aux fins d'exécution du contrat (art. 6.1.b RGPD). Jamais cédées ni revendues à des tiers. Aucun transfert hors EEE. Conservation : durée du contrat + 5 ans. Droits d'accès, rectification, effacement, portabilité et opposition : sav@labelenergie.fr ou courrier au siège avec pièce d'identité. Réclamation possible auprès de la CNIL (www.cnil.fr).</p>

    <div class="at">Article 10 — Litiges et droit applicable</div>
    <p class="ab">Droit applicable : droit français. Réclamation écrite préalable au Prestataire (LRAR ou e-mail). Solution amiable recherchée dans les 90 jours.</p>
    <div class="med-box">
      Médiation gratuite — MÉDIATION EN SEINE (N°02031320)<br/>
      17/25 avenue du Maréchal Joffre — 92000 NANTERRE — consommation@mediation-en-seine.org
    </div>

    <div class="at">Article 11 — Responsabilité</div>
    <p class="ab">LABEL ENERGIE est assuré pour sa responsabilité civile professionnelle et décennale (MIC Insurance Company n°LUN2601434). Responsabilité limitée aux dommages directs et prévisibles, dans la limite du montant annuel du contrat en cas de faute simple.</p>

    <div class="at">Article 12 — Signature et acceptation</div>
    <div style="background:#f5f8fa;border:1px solid #dde4e8;padding:8px 12px;margin-bottom:6px;font-size:8pt;line-height:1.6">
      En signant ce contrat, le Client confirme avoir lu et compris l'intégralité des conditions générales, des exclusions de garantie et des modalités de résiliation. Il les accepte sans réserve.
    </div>
    <p style="font-size:8pt;color:#555;font-style:italic;margin-bottom:14px">Fait en deux exemplaires originaux, dont un conservé par chaque partie.</p>

    ${renderPdfFaitALeSignatureRowHtml(data, {
      signatureAnchor: 'DS_SIGNATURE_CLIENT',
      rightCaptionHtml:
        'Signature du Client<br/>(précédée de la mention « Lu et approuvé »)',
      signatureImg,
    })}
  </div>
  ${renderPgFooter(3)}
</div>
`
  );
}

function getPage4SepaHtml(data: ContractPdfData): string {
  const titulaire = data.gocardlessAccountHolder || '';
  const address = data.gocardlessAddress || data.clientAddress?.street || '';
  const iban = data.gocardlessIban || '';
  const city = data.gocardlessCity || data.clientAddress?.city || '';
  const signatureImg = normalizeSignatureDataUrl(data.signatureImageBase64);

  return wrapHtml(
    'Contrat Label Energie — Page 4',
    `
<div class="page">
  ${renderPgHdr()}
  <div class="body">
    <div class="sec-title">Mandat de prélèvement SEPA</div>
    <p class="ab" style="margin-bottom:12px">En complétant ce mandat, vous autorisez LABEL ENERGIE à prélever votre cotisation mensuelle. Vous bénéficiez d'un droit de remboursement dans les 8 semaines suivant tout prélèvement non autorisé.</p>
    <table class="stbl">
      <tbody>
        <tr><td class="sk">Créancier</td><td style="border:1px solid #c8d4da;padding:6px 10px">LABEL ENERGIE SAS</td></tr>
        <tr><td class="sk">ICS (Identifiant Créancier SEPA)</td><td class="sv"><span class="sg">→ À compléter par LABEL ENERGIE</span></td></tr>
        <tr><td class="sk">Référence Unique Mandat (RUM)</td><td class="sv"><span class="sg">${
          data.contractNumber ? escapeHtml(data.contractNumber) : '→ Généré automatiquement'
        }</span></td></tr>
        <tr><td class="sk">Nom du titulaire du compte</td><td class="sv">${
          titulaire ? escapeHtml(titulaire) : `<span class="sg">→ Champ à renseigner</span>`
        }</td></tr>
        <tr><td class="sk">Adresse du titulaire</td><td class="sv">${
          [address, city].filter(Boolean).join(', ')
            ? escapeHtml([address, city].filter(Boolean).join(', '))
            : `<span class="sg">→ Champ à renseigner</span>`
        }</td></tr>
        <tr><td class="sk">BIC</td><td class="sv"><span class="sg">→ Champ à renseigner</span></td></tr>
        <tr><td class="sk">IBAN</td><td class="sv">${iban ? escapeHtml(iban) : `<span class="sg">→ Champ à renseigner</span>`}</td></tr>
        <tr><td class="sk">Type de prélèvement</td><td style="border:1px solid #c8d4da;padding:6px 10px">Récurrent — mensuel automatique</td></tr>
      </tbody>
    </table>
    <p class="sepa-note">En signant ce mandat, le débiteur autorise LABEL ENERGIE à envoyer des instructions à sa banque pour débiter son compte conformément aux instructions de LABEL ENERGIE. Le débiteur bénéficie du droit d'être remboursé par sa banque selon les conditions de l'accord conclu avec elle. Sa demande de remboursement doit être présentée dans les 8 semaines suivant la date de débit pour un prélèvement autorisé.</p>
    ${renderPdfFaitALeSignatureRowHtml(data, {
      signatureAnchor: 'DS_SIGNATURE_SEPA',
      rightCaptionHtml:
        'Signature du titulaire du compte<br/>(précédée de la mention « Lu et approuvé »)',
      signatureImg,
    })}
  </div>
  ${renderPgFooter(4)}
</div>
`
  );
}

function getPage5RetractationHtml(data: ContractPdfData): string {
  /** Date de souscription affichée dans le tableau (différente de la ligne « Le : » = jour de signature). */
  const contractSubscribedAt = formatDateFr(data.createdAt);
  const signatureImg = normalizeSignatureDataUrl(data.signatureImageBase64);
  const clientName =
    data.clientName ||
    (data.clientContact?.firstName || data.clientContact?.lastName
      ? `${data.clientContact?.firstName || ''} ${data.clientContact?.lastName || ''}`.trim()
      : '');
  const address = [
    data.clientAddress?.street || data.gocardlessAddress || '',
    data.clientAddress?.postalCode || data.gocardlessPostalCode || '',
    data.clientAddress?.city || data.gocardlessCity || '',
  ]
    .filter(Boolean)
    .join(', ');
  const email = data.clientContact?.email || '';
  const phone = data.clientContact?.phone || '';

  return wrapHtml(
    'Contrat Label Energie — Page 5',
    `
<div class="page">
  ${renderPgHdr()}
  <div class="body">
    <div class="sec-title" style="margin-top:6px">Formulaire de rétractation</div>
    <p class="ab" style="margin-bottom:4px">Conformément aux articles L.221-18 et suivants du Code de la consommation, vous disposez d'un délai de 14 jours calendaires à compter de la signature pour exercer votre droit de rétractation, sans justification ni pénalité.</p>
    <p style="font-size:8pt;font-weight:700;color:#0D2B3E;margin:4px 0 3px;line-height:1.45">À retourner par courrier recommandé avec accusé de réception à : LABEL ENERGIE — Service Résiliation — 3 allée du 1er Mai — 77183 Croissy-Beaubourg, ou par e-mail à sav@labelenergie.fr.</p>
    <p style="font-size:8pt;margin-bottom:4px">Je soussigné(e) notifie ma décision de me rétracter du contrat d'entretien souscrit auprès de LABEL ENERGIE.</p>
    <table class="rftbl" style="margin:6px 0">
      <tbody>
        <tr><td class="rk">Contrat souscrit le</td><td class="rv">${contractSubscribedAt ? escapeHtml(contractSubscribedAt) : `<span class="auto">→ Champ à compléter</span>`}</td></tr>
        <tr><td class="rk">Nom / Prénom</td><td class="rv">${clientName ? escapeHtml(clientName) : `<span class="auto">→ Champ à compléter</span>`}</td></tr>
        <tr><td class="rk">Adresse</td><td class="rv">${address ? escapeHtml(address) : `<span class="auto">→ Champ à compléter</span>`}</td></tr>
        <tr><td class="rk">Email</td><td class="rv">${email ? escapeHtml(email) : `<span class="auto">→ Champ à compléter</span>`}</td></tr>
        <tr><td class="rk">Téléphone</td><td class="rv">${phone ? escapeHtml(phone) : `<span class="auto">→ Champ à compléter</span>`}</td></tr>
      </tbody>
    </table>
    <div style="margin-top:10px">
      ${renderPdfFaitALeSignatureRowHtml(data, {
        signatureAnchor: 'DS_SIGNATURE_RETRACTATION',
        rightCaptionHtml: 'Signature<br/>(précédée de la mention « Lu et approuvé »)',
        signatureImg,
        addressFallback: address,
      })}
    </div>
  </div>
  <div style="border-top:1px solid #dde4e8;padding:6px 28px 4px;margin-top:8px;flex-shrink:0">
    <p style="font-size:6.5pt;color:#888;text-align:center;line-height:1.55;margin:0 0 4px">
      LABEL ENERGIE SAS — Capital 200 000 € · SIREN 890 462 625 — SIRET 890 462 625 00025 · TVA FR30890462625 · 3 allée du 1er Mai, 77183 Croissy-Beaubourg · Médiateur : MÉDIATION EN SEINE N°02031320 · CGV v. 1er avril 2026
    </p>
    <div class="pg-footer" style="border-top:none;padding:4px 0 0;margin:0">LABEL ENERGIE SAS · 3 allée du 1er Mai, 77183 Croissy-Beaubourg · SIREN 890 462 625 · v. 2026 · Page 5 /</div>
  </div>
</div>
`
  );
}

/**
 * Récupère l'image de signature (backend) et la retourne en data URL.
 */
export async function fetchSignatureImageDataUrl(apiBaseUrl: string, envelopeId: string): Promise<string | null> {
  const url = `${apiBaseUrl.replace(/\/$/, '')}/api/yousign/signature-request/${encodeURIComponent(envelopeId)}/signature-image`;
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Prépare les données pour le PDF à partir des données “maintenance”.
 * On garde cette signature car elle est utilisée dans `new-maintenance-modal.tsx`.
 */
export function prepareContractData(maintenanceData: unknown): ContractPdfData {
  const md = (maintenanceData || {}) as Record<string, unknown>;

  const namesRaw = md.equipmentNames;
  const names: string[] = Array.isArray(namesRaw) ? (namesRaw as string[]) : namesRaw ? [String(namesRaw)] : [];
  const detailsMultiple = (md.equipmentDetailsMultiple || {}) as Record<string, any>;
  const orderIdsRaw = md.selectedEquipmentTypes;
  const orderIds: string[] =
    Array.isArray(orderIdsRaw) && (orderIdsRaw as unknown[]).length === names.length
      ? (orderIdsRaw as string[])
      : Object.keys(detailsMultiple);

  const formatDateMiseEnService = (raw: string): string => {
    if (!raw || !String(raw).trim()) return '';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const equipments: Equipment[] = [];
  names.forEach((name, index) => {
    const typeId = orderIds[index] ?? '';
    const details = (detailsMultiple[typeId] || md.equipmentDetails || {}) as Record<string, unknown>;
    const dateMiseEnService = formatDateMiseEnService(
      String(
        details.dateMiseEnService ||
          md.dateMiseEnService ||
          md.projectCompletedAt ||
          md.lastMaintenance ||
          ''
      )
    );

    equipments.push({
      id: `dynamic-equipment-${index}`,
      name: name || 'Équipement',
      price: typeof details.monthlyPrice === 'number' ? details.monthlyPrice : (md.monthlyAmount as number) || 0,
      selected: true,
      typeId: typeId || undefined,
      fields: [
        { label: 'Marque', value: String(details.marque || '') },
        { label: 'Modèle', value: String(details.modele || '') },
        { label: 'N° de série', value: String(details.numeroSerie || details.serial || '') },
        { label: "Date d'installation", value: dateMiseEnService },
      ],
    });
  });

  return {
    contractNumber: String(md.contractNumber || md.contractId || 'CONTRACT-UNKNOWN'),
    clientName: String(md.clientName || 'Client'),
    createdAt: (md.createdAt as string) || new Date(),
    monthlyAmount: typeof md.monthlyAmount === 'number' ? md.monthlyAmount : 0,
    paymentMethod: String(md.paymentMethod || ''),
    equipment: equipments.length ? equipments : undefined,
    clientContact: (md.clientContact as ContractPdfData['clientContact']) || {},
    clientAddress:
      (md.clientAddress as ContractPdfData['clientAddress']) || {
        street: String(md.gocardlessAddress || ''),
        postalCode: String(md.gocardlessPostalCode || ''),
        city: String(md.gocardlessCity || ''),
        country: String(md.gocardlessCountry || 'France'),
      },
    gocardlessAccountHolder: String(md.gocardlessAccountHolder || ''),
    gocardlessAddress: String(md.gocardlessAddress || ''),
    gocardlessCity: String(md.gocardlessCity || ''),
    gocardlessPostalCode: String(md.gocardlessPostalCode || ''),
    gocardlessCountry: String(md.gocardlessCountry || ''),
    gocardlessIban: String(md.gocardlessIban || ''),
    signatureStatus: (md.signatureStatus as ContractSignatureStatus) || 'pending',
    signatureDate: md.signatureDate as string | undefined,
    signatureImageBase64:
      (md.signatureImageBase64 as string | undefined) ??
      (md.signature_image_base64 as string | undefined) ??
      undefined,
  };
}

async function renderHtmlPageToPdfImage(
  doc: jsPDF,
  html: string,
  addNewPage: boolean
): Promise<{ anchorMap: Map<string, { x: number; y: number }> }> {
  const HTML_W = 794;
  const HTML_H = 1123;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '0';
  iframe.style.top = '0';
  iframe.style.width = `${HTML_W}px`;
  iframe.style.height = `${HTML_H}px`;
  iframe.style.opacity = '0.01';
  iframe.style.pointerEvents = 'none';
  iframe.style.zIndex = '2147483647';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument!;
  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve();
    // fallback: certaines plateformes ne déclenchent pas onload après document.write
    setTimeout(resolve, 50);
  });

  // attendre polices/images
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const images = iframeDoc.body.querySelectorAll('img');
  if (images.length) {
    await new Promise<void>((resolve) => {
      let done = 0;
      const finish = () => {
        done++;
        if (done >= images.length) resolve();
      };
      images.forEach((img) => {
        const im = img as HTMLImageElement;
        if (im.complete) finish();
        else {
          im.onload = finish;
          im.onerror = finish;
        }
      });
      setTimeout(resolve, 1500);
    });
    for (const img of Array.from(images)) {
      const im = img as HTMLImageElement;
      if (im.src?.startsWith('data:') && 'decode' in im) {
        try {
          await im.decode();
        } catch {
          /* ignore decode errors (html2canvas peut quand même peindre) */
        }
      }
    }
  }

  const pageEl = (iframeDoc.querySelector('.page') as HTMLElement) || iframeDoc.body;
  const pageRect = pageEl.getBoundingClientRect();
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  // collect DS_* anchors positions
  const anchorMap = new Map<string, { x: number; y: number }>();
  const spans = Array.from(pageEl.querySelectorAll('span')) as HTMLElement[];
  spans.forEach((s) => {
    const t = (s.textContent || '').trim();
    if (!t.startsWith('DS_')) return;
    const r = s.getBoundingClientRect();
    anchorMap.set(t, { x: clamp(r.left - pageRect.left, 0, HTML_W), y: clamp(r.top - pageRect.top, 0, HTML_H) });
  });

  const canvas = await html2canvas(pageEl, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    width: HTML_W,
    height: HTML_H,
    windowWidth: HTML_W,
    windowHeight: HTML_H,
    scrollX: 0,
    scrollY: 0,
  });

  document.body.removeChild(iframe);

  const imgData = canvas.toDataURL('image/jpeg', 0.92);
  if (addNewPage) doc.addPage();
  doc.addImage(imgData, 'JPEG', 0, 0, 210, 297);

  return { anchorMap };
}

export async function downloadContractPdf(data: ContractPdfData, download: boolean = true): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // px -> mm conversion (A4 @ 794×1123 px)
  const PAGE_W_MM = 210;
  const PAGE_H_MM = 297;
  const HTML_W_PX = 794;
  const HTML_H_PX = 1123;
  const pxToMmX = (px: number) => (px / HTML_W_PX) * PAGE_W_MM;
  const pxToMmY = (px: number) => (px / HTML_H_PX) * PAGE_H_MM;

  const stampAnchor = (anchor: string, xPx: number, yPx: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(1);
    doc.setTextColor(255, 255, 255);
    doc.text(anchor, pxToMmX(xPx), pxToMmY(yPx));
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
  };

  const pages: Array<{ html: string; anchorsToStamp: string[] }> = [
    { html: getPage1Html(data), anchorsToStamp: [] },
    { html: getPage2Html(), anchorsToStamp: [] },
    { html: getPage3Html(data), anchorsToStamp: ['DS_SIGNATURE_CLIENT'] },
    { html: getPage4SepaHtml(data), anchorsToStamp: ['DS_SIGNATURE_SEPA'] },
    {
      html: getPage5RetractationHtml(data),
      anchorsToStamp: ['DS_SIGNATURE_RETRACTATION'],
    },
  ];

  for (let i = 0; i < pages.length; i++) {
    const { html, anchorsToStamp } = pages[i];
    const { anchorMap } = await renderHtmlPageToPdfImage(doc, html, i !== 0);
    anchorsToStamp.forEach((a) => {
      const pos = anchorMap.get(a);
      if (pos) stampAnchor(a, pos.x, pos.y + 6);
    });
  }

  const pdfBlob = doc.output('blob');

  if (download) {
    const url = URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    link.href = url;
    const clientNameForFile = data.clientName ? data.clientName.replace(/\\s+/g, '_') : 'Client';
    link.download = `Contrat_${data.contractNumber || 'CONTRACT'}_${clientNameForFile}.pdf`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  }

  return pdfBlob;
}
