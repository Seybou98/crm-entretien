import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser
} from "firebase/auth";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  setDoc,
  getDoc
} from "firebase/firestore";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db } from "./lib/firebase";
import { getDocTracked, getDocsTracked } from "./src/lib/firestoreReads";
import logoUrl from "./Logo_Label.png";
import { SiteHeader } from "./src/components/SiteHeader";
import { CreateContractModal, type ContractRequestPayload, type ContractFormula } from "./src/components/contracts/CreateContractModal";
import { PublicChatbotWidget } from "./src/chatbot/PublicChatbotWidget";
import type { ContractPdfData, Equipment } from "./src/utils/contract-pdf-generator";
import { downloadContractPdf } from "./src/utils/contract-pdf-generator";
import {
  createPortalContractAndSendForSignature,
  createPortalMaintenanceForContract,
} from "./src/lib/gocardless-backend";

// ── Types ──────────────────────────────────────────────────────────────────
type AuthTab = "login" | "signup";

interface PasswordStrength {
  width: string;
  color: string;
  label: string;
}

// ── CSS-in-JS (global styles injected once) ───────────────────────────────
export const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;1,9..40,300&display=swap');

    :root {
      --cyan:#00B8DC; --teal:#00C9A7;
      --cyan-10:rgba(0,184,220,0.08); --teal-10:rgba(0,201,167,0.08);
      --cyan-20:rgba(0,184,220,0.15); --border-cyan:rgba(0,184,220,0.28);
      --bg:#FFFFFF; --bg2:#F7F9FC; --bg3:#EEF2F7;
      --border:rgba(0,0,0,0.07); --border-strong:rgba(0,0,0,0.12);
      --text:#0D1B2A; --text-secondary:#4A5568; --text-muted:#8896A6;
      --radius:20px; --radius-sm:12px;
      --shadow-sm:0 1px 4px rgba(0,0,0,0.06),0 4px 16px rgba(0,0,0,0.04);
      --shadow-md:0 4px 24px rgba(0,0,0,0.08),0 1px 4px rgba(0,0,0,0.04);

      /* Layout tokens (standard spacing + responsive) */
      --header-h:64px;
      /* Wider “normal website” container + smaller side gutters */
      --container-max:1280px;
      --container-px:24px;
      --section-py:88px;
      --hero-pt:72px;
      --hero-pb:80px;
    }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html{scroll-behavior:smooth;overflow-x:hidden}
    body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden;-webkit-font-smoothing:antialiased}
    #root{overflow-x:hidden}
    ::-webkit-scrollbar{width:5px}
    ::-webkit-scrollbar-track{background:var(--bg2)}
    ::-webkit-scrollbar-thumb{background:rgba(0,184,220,0.3);border-radius:3px}

    @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes overlayIn{from{opacity:0}to{opacity:1}}
    @keyframes modalIn{from{opacity:0;transform:translateY(20px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes shake{
      0%{transform:translateX(0)}
      20%{transform:translateX(-8px)}
      40%{transform:translateX(8px)}
      60%{transform:translateX(-5px)}
      80%{transform:translateX(5px)}
      100%{transform:translateX(0)}
    }
    .shake-anim{animation:shake 350ms ease}

    .reveal{opacity:0;transform:translateY(24px);transition:opacity .65s ease,transform .65s ease}
    .reveal.visible{opacity:1;transform:translateY(0)}

    .hero-badge-dot{animation:blink 2s infinite}
    .hero-grid{
      width:100%;
      max-width:var(--container-max);
      margin:0 auto;
      display:grid;
      grid-template-columns:minmax(0,1.02fr) minmax(360px,.98fr);
      gap:32px;
      align-items:center;
      position:relative;
      z-index:1;
    }
    .hero-copy{text-align:left}
    .hero-visual-wrap{position:relative}
    .hero-visual-card{
      position:relative;
      min-height:640px;
      border-radius:32px;
      overflow:hidden;
      border:1px solid rgba(255,255,255,0.62);
      background:linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06));
      box-shadow:0 24px 80px rgba(13,27,42,0.12);
    }
    .hero-visual-img{
      position:absolute;
      inset:0;
      width:100%;
      height:100%;
      object-fit:cover;
    }
    .hero-visual-overlay{
      position:absolute;
      inset:0;
      background:linear-gradient(180deg, rgba(10,22,36,0.06) 0%, rgba(10,22,36,0.24) 100%);
    }
    .hero-visual-pill{
      position:absolute;
      top:18px;
      right:18px;
      display:inline-flex;
      align-items:center;
      gap:8px;
      padding:10px 14px;
      border-radius:999px;
      background:rgba(255,255,255,0.84);
      border:1px solid rgba(255,255,255,0.72);
      backdrop-filter:blur(12px);
      color:var(--text);
      font-size:12px;
      font-weight:700;
      box-shadow:0 10px 24px rgba(13,27,42,0.10);
    }
    .hero-floating-card{
      position:absolute;
      left:20px;
      right:20px;
      bottom:20px;
      display:grid;
      gap:12px;
      padding:18px 18px 16px;
      border-radius:24px;
      backdrop-filter:blur(16px);
      background:rgba(255,255,255,0.8);
      border:1px solid rgba(255,255,255,0.65);
      box-shadow:0 16px 40px rgba(13,27,42,0.16);
    }
    .hero-floating-metrics{
      display:grid;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:10px;
    }
    .hero-floating-metric{
      padding:12px 12px 10px;
      border-radius:16px;
      background:rgba(247,249,252,0.92);
      border:1px solid rgba(13,27,42,0.06);
    }
    .equip-grid{
      grid-template-columns:repeat(12,minmax(0,1fr))!important;
      gap:18px!important;
    }
    .equip-card-premium{
      position:relative;
      overflow:hidden;
      padding:0!important;
      min-height:420px;
    }
    .equip-card-premium.eq-wide{
      grid-column:span 7!important;
      min-height:470px;
    }
    .equip-card-premium:not(.eq-wide){
      grid-column:span 5!important;
    }
    .equip-card-img{
      position:absolute;
      inset:0;
      width:100%;
      height:100%;
      object-fit:cover;
      transform:scale(1.01);
      transition:transform .45s ease;
    }
    .equip-card-premium:hover .equip-card-img{
      transform:scale(1.06);
    }
    .equip-card-overlay{
      position:absolute;
      inset:0;
      background:linear-gradient(180deg, rgba(8,20,32,0.10) 0%, rgba(8,20,32,0.78) 78%);
    }
    .equip-card-content{
      position:relative;
      z-index:1;
      display:flex;
      flex-direction:column;
      justify-content:flex-end;
      height:100%;
      padding:26px;
      color:#fff;
    }
    .equip-card-bottom{
      display:flex;
      align-items:flex-end;
      justify-content:space-between;
      gap:16px;
      flex-wrap:wrap;
      margin-top:18px;
    }
    .equip-card-price{
      display:flex;
      flex-direction:column;
      gap:4px;
      padding:14px 16px;
      border-radius:18px;
      background:rgba(255,255,255,0.12);
      border:1px solid rgba(255,255,255,0.18);
      backdrop-filter:blur(14px);
    }
    .equip-card-cta{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:10px;
      min-width:168px;
      padding:13px 18px;
      border-radius:999px;
      background:#fff;
      color:var(--text);
      border:none;
      font-family:'DM Sans',sans-serif;
      font-size:14px;
      font-weight:700;
      box-shadow:0 12px 28px rgba(13,27,42,0.18);
    }

    /* Equipements: intro split -> stack on mobile */
    .equip-intro-grid{
      display:grid;
      grid-template-columns: minmax(0,1.3fr) minmax(280px,.7fr);
      gap:18px;
      align-items:stretch;
      margin-top:24px;
    }
    @media(max-width:768px){
      .equip-intro-grid{ grid-template-columns: 1fr !important; }
      .equip-intro-media{ min-height: 220px !important; border-radius: 24px !important; }
      .equip-intro-side{ padding: 18px !important; border-radius: 24px !important; }
    }
    @media(max-width:480px){
      .equip-intro-media{ min-height: 200px !important; }
    }

    .eq-card{transition:all .25s}
    .eq-card:hover{border-color:var(--border-cyan)!important;transform:translateY(-3px);box-shadow:var(--shadow-md)!important;background:#fff!important}

    .plan-card{transition:all .25s}
    .plan-card:hover{transform:translateY(-4px);box-shadow:var(--shadow-md)!important}
    .plan-card-premium{
      overflow:hidden;
      border-radius:28px!important;
      box-shadow:0 18px 44px rgba(13,27,42,0.08)!important;
    }
    .plan-card-premium.is-recommended{
      transform:translateY(-8px);
      box-shadow:0 24px 56px rgba(0,184,220,0.18)!important;
    }
    .plan-card-premium:hover{
      transform:translateY(-8px);
    }
    .section-shell-premium{
      position:relative;
      overflow:hidden;
      border-radius:34px;
      border:1px solid rgba(13,27,42,0.06);
      background:linear-gradient(180deg, rgba(255,255,255,0.96), rgba(247,249,252,0.88));
      box-shadow:0 24px 64px rgba(13,27,42,0.08);
    }
    .cta-primary-premium{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:10px;
      padding:15px 26px;
      border-radius:999px;
      background:linear-gradient(135deg,var(--cyan),var(--teal));
      color:#fff;
      border:none;
      cursor:pointer;
      font-family:'DM Sans',sans-serif;
      font-size:14px;
      font-weight:800;
      box-shadow:0 14px 32px rgba(0,184,220,0.24);
      text-decoration:none;
      transition:transform .2s ease, box-shadow .2s ease, filter .2s ease;
    }
    .cta-primary-premium:hover{
      transform:translateY(-2px);
      box-shadow:0 18px 36px rgba(0,184,220,0.28);
      filter:saturate(1.03);
    }
    .cta-secondary-premium{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:10px;
      padding:14px 24px;
      border-radius:999px;
      background:rgba(255,255,255,0.86);
      color:var(--text);
      border:1px solid rgba(13,27,42,0.10);
      cursor:pointer;
      font-family:'DM Sans',sans-serif;
      font-size:14px;
      font-weight:700;
      text-decoration:none;
      box-shadow:0 10px 24px rgba(13,27,42,0.06);
      transition:transform .2s ease, box-shadow .2s ease, border-color .2s ease, background .2s ease;
    }
    .cta-secondary-premium:hover{
      transform:translateY(-2px);
      background:#fff;
      border-color:rgba(0,184,220,0.18);
      box-shadow:0 14px 28px rgba(13,27,42,0.08);
    }
    .testi-shell{
      position:relative;
      overflow:hidden;
      border-radius:34px;
      border:1px solid rgba(13,27,42,0.06);
      background:linear-gradient(180deg, #f8fbfd 0%, #eef5fb 100%);
      box-shadow:0 22px 60px rgba(13,27,42,0.08);
    }
    .testi-card-premium{
      border:1px solid rgba(13,27,42,0.08)!important;
      background:rgba(255,255,255,0.96)!important;
      box-shadow:0 16px 40px rgba(13,27,42,0.08)!important;
    }

    .why-card{transition:all .25s}
    .why-card:hover{border-color:var(--border-cyan)!important;transform:translateY(-2px);box-shadow:var(--shadow-md)!important}

    .fidelity-step{transition:all .25s}
    .fidelity-step:hover{border-color:var(--border-cyan)!important;transform:translateY(-2px)}

    .cert-pill{transition:all .2s}
    .cert-pill:hover{border-color:var(--border-cyan)!important;color:var(--text)!important}

    /* Header call-to-action (desktop number + mobile icon) */
    .header-call{
      display:inline-flex;
      align-items:center;
      gap:10px;
      padding: 10px 14px;
      border-radius: 999px;
      background: rgba(0,184,220,0.10);
      border: 1px solid rgba(0,184,220,0.18);
      color: var(--text);
      text-decoration:none;
      font-family:'DM Sans',sans-serif;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: -0.01em;
      box-shadow: 0 10px 24px rgba(13,27,42,0.06);
      transition: transform .2s ease, box-shadow .2s ease, background .2s ease, border-color .2s ease;
    }
    .header-call:hover{
      transform: translateY(-1px);
      background: rgba(0,184,220,0.14);
      border-color: rgba(0,184,220,0.24);
      box-shadow: 0 14px 28px rgba(13,27,42,0.08);
    }
    .header-call__icon{
      width: 28px;
      height: 28px;
      border-radius: 999px;
      display:flex;
      align-items:center;
      justify-content:center;
      background: linear-gradient(135deg,var(--cyan),var(--teal));
      color:#fff;
      flex-shrink:0;
      box-shadow: 0 10px 22px rgba(0,184,220,0.16);
    }
    .header-call__text{ display:block; }
    .header-call__sub{ display:block; font-size: 11px; font-weight: 600; color: var(--text-muted); margin-top: 1px; }
    @media(max-width:768px){
      .header-call{
        padding: 0;
        width: 40px;
        height: 40px;
        justify-content:center;
        border-radius: 999px;
        background: transparent;
        border: none;
        box-shadow: none;
      }
      .header-call__icon{ width: 40px; height: 40px; }
      .header-call__text{ display:none; }
    }

    /* Accessible focus rings */
    :where(a, button, input, textarea, select, [role="button"], [tabindex]):focus-visible{
      outline: 3px solid rgba(0,184,220,0.35);
      outline-offset: 3px;
      border-radius: 12px;
    }

    /* Hide decorative blurs on very small screens (avoid jank) */
    @media (max-width:480px){
      .hero-blur{ display:none !important; }
    }

    /* Testimonials marquee (auto-loop) */
    .testi-marquee{
      position:relative;
      overflow:hidden;
      padding: 6px 0 14px;
      mask-image: linear-gradient(90deg, transparent 0%, #000 8%, #000 92%, transparent 100%);
      -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 8%, #000 92%, transparent 100%);
    }
    .testi-track{
      display:flex;
      gap:14px;
      width:max-content;
      will-change:transform;
      animation: testiMarquee 32s linear infinite;
    }
    .testi-card{
      flex:0 0 clamp(280px, 34vw, 420px);
    }
    @keyframes testiMarquee{
      from{ transform: translateX(0); }
      to{ transform: translateX(-50%); }
    }
    @media (prefers-reduced-motion: reduce){
      .testi-track{ animation:none; }
      .testi-marquee{ overflow-x:auto; -webkit-overflow-scrolling:touch; mask-image:none; -webkit-mask-image:none; }
    }

    /* Brand marquee (auto-loop) */
    .brand-strip{
      position:relative;
      padding: 18px 0;
      border-top: 1px solid rgba(13,27,42,0.06);
      border-bottom: 1px solid rgba(13,27,42,0.06);
      background: linear-gradient(180deg, rgba(247,249,252,0.72), rgba(255,255,255,0.86));
      overflow:hidden;
    }
    .brand-marquee{
      position:relative;
      overflow:hidden;
      mask-image: linear-gradient(90deg, transparent 0%, #000 10%, #000 90%, transparent 100%);
      -webkit-mask-image: linear-gradient(90deg, transparent 0%, #000 10%, #000 90%, transparent 100%);
    }
    .brand-track{
      display:flex;
      align-items:center;
      gap: 26px;
      width:max-content;
      will-change:transform;
      animation: brandMarquee 28s linear infinite;
      padding: 10px 0;
    }
    .brand-item{
      height: 30px;
      width: auto;
      display:block;
      opacity: .92;
      filter: none;
      transition: opacity .2s ease, transform .2s ease;
    }
    .brand-track:hover .brand-item{ opacity: .82; }
    .brand-track:hover .brand-item:hover{ opacity: 1; transform: translateY(-1px); }
    @keyframes brandMarquee{
      from{ transform: translateX(0); }
      to{ transform: translateX(-50%); }
    }
    @media (prefers-reduced-motion: reduce){
      .brand-track{ animation:none; }
      .brand-marquee{ overflow-x:auto; -webkit-overflow-scrolling:touch; mask-image:none; -webkit-mask-image:none; }
    }
    @media(max-width:480px){
      .brand-item{ height: 24px; opacity: .9; filter:none; }
      .brand-track{ gap: 18px; }
      .brand-strip{ padding: 14px 0; }
      .brand-marquee{ mask-image:none; -webkit-mask-image:none; }
    }

    /* Trust / logo wall (Qualifications + Partners) */
    .trust-wall{
      background: linear-gradient(135deg, rgba(0,184,220,0.06), rgba(0,201,167,0.06));
      border: 1px solid rgba(0,184,220,0.14);
      border-radius: 28px;
      padding: 22px;
      box-shadow: 0 22px 54px rgba(13,27,42,0.08);
      overflow: hidden;
      position: relative;
    }
    .trust-wall:before{
      content:"";
      position:absolute;
      inset:-80px -120px auto auto;
      width: 320px;
      height: 320px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,255,255,0.65), transparent 70%);
      pointer-events:none;
    }
    .trust-grid{
      display: grid;
      grid-template-columns: 1fr;
      gap: 18px;
      position: relative;
      z-index: 1;
    }
    .trust-block{
      background: rgba(255,255,255,0.78);
      border: 1px solid rgba(13,27,42,0.08);
      border-radius: 22px;
      padding: 16px;
      backdrop-filter: blur(10px);
    }
    .trust-head{
      display:flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .trust-kicker{
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: rgba(13,27,42,0.62);
    }
    .trust-sub{
      font-size: 12px;
      color: rgba(13,27,42,0.55);
    }
    .logo-grid{
      display:grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .logo-tile{
      height: 74px;
      border-radius: 18px;
      background: rgba(255,255,255,0.92);
      border: 1px solid rgba(13,27,42,0.08);
      box-shadow: 0 10px 26px rgba(13,27,42,0.06);
      display:flex;
      align-items:center;
      justify-content:center;
      padding: 12px 14px;
      transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease;
    }
    .logo-tile img{
      height: 42px;
      width: 100%;
      display:block;
      object-fit: contain;
      filter: none;
      opacity: 1;
      transition: opacity .18s ease;
    }
    .logo-tile:hover{
      transform: translateY(-2px);
      border-color: rgba(0,184,220,0.25);
      box-shadow: 0 18px 44px rgba(13,27,42,0.10);
      background: rgba(255,255,255,0.98);
    }
    .logo-tile:hover img{ opacity: 1; }
    .logo-grid.partners{
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .logo-grid.partners .logo-tile{
      height: 84px;
    }
    .logo-grid.partners .logo-tile img{
      height: 52px;
      width: 100%;
    }
    @media(max-width:768px){
      .logo-grid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .trust-wall{ border-radius: 24px; padding: 18px; }
      .trust-block{ border-radius: 20px; }
    }

    @media(max-width:1024px){
      :root{
        --container-px:20px;
        --container-max:1120px;
        --section-py:72px;
        --hero-pt:64px;
        --hero-pb:72px;
      }
      /* Keep layouts feeling “standard” on tablets */
      .equip-grid,.plans-grid,.testi-grid{grid-template-columns:repeat(2,1fr)!important}
      .eq-wide{grid-column:span 2!important}
      .why-grid{grid-template-columns:1fr!important}
      .why-wide{grid-column:span 1!important}

      .process-grid{grid-template-columns:repeat(3, minmax(0,1fr))!important}
    }

    @media(max-width:768px){
      :root{
        --container-px:16px;
        --section-py:64px;
        --hero-pt:56px;
        --hero-pb:64px;
      }
      .nav-links-ul{display:none!important}
      .hero-grid{grid-template-columns:1fr!important;gap:20px!important}
      .hero-copy{text-align:center!important}
      .hero-visual-card{min-height:420px!important}
      .hero-floating-metrics{grid-template-columns:1fr!important}
      .plan-card-premium,.testi-shell,.section-shell-premium{border-radius:26px!important}
      .section-shell-premium{padding:18px!important}
      .testi-shell{padding:28px 0!important}
      .plan-card-premium.is-recommended,
      .plan-card-premium:hover{transform:none!important}
      .hero-stats-wrap{gap:24px!important;flex-wrap:wrap!important;justify-content:center!important}
      .equip-grid,.plans-grid,.why-grid,.testi-grid,.process-grid,.aides-grid{grid-template-columns:1fr!important}
      .eq-wide,.why-wide{grid-column:span 1!important}
      .equip-card-premium,.equip-card-premium.eq-wide,.equip-card-premium:not(.eq-wide){grid-column:span 1!important;min-height:380px!important}
      .why-wide-inner{flex-direction:column!important;gap:20px!important}
      .fidelity-steps-wrap{flex-direction:column!important}
      .cta-banner-inner{padding:40px 24px!important}
      .cta-actions-wrap{flex-direction:column!important}
      footer{flex-direction:column!important;gap:20px!important;text-align:center!important;padding:32px 20px!important}
      .modal-body-pad{padding:28px 24px 32px!important}
      .field-row-grid{grid-template-columns:1fr!important}

      /* Process: horizontal scroll (mobile) */
      .process-grid{
        display:flex!important;
        gap:12px!important;
        overflow-x:auto!important;
        overflow-y:hidden!important;
        padding: 2px 2px 10px!important;
        scroll-snap-type:x mandatory;
        -webkit-overflow-scrolling:touch;
      }
      .process-grid > *{
        flex:0 0 86%;
        scroll-snap-align:start;
      }
      .process-grid::-webkit-scrollbar{height:6px}
      .process-grid::-webkit-scrollbar-track{background:transparent}
      .process-grid::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.12);border-radius:999px}
    }

    @media(max-width:480px){
      :root{
        --container-px:12px;
        --section-py:56px;
        --hero-pt:52px;
        --hero-pb:56px;
      }
      /* Hero visual must be tall enough to fit the floating card */
      .hero-visual-card{min-height:440px!important;border-radius:24px!important}
      .hero-floating-card{left:14px!important;right:14px!important;bottom:14px!important;padding:14px!important}
      /* Make the “Intervention terrain” pill and floating card readable */
      .hero-visual-overlay{
        background:linear-gradient(180deg, rgba(10,22,36,0.10) 0%, rgba(10,22,36,0.42) 100%)!important;
      }
      .hero-visual-pill{
        top:12px!important;
        right:12px!important;
        left:12px!important;
        justify-content:center!important;
        background:rgba(255,255,255,0.94)!important;
        border:1px solid rgba(13,27,42,0.10)!important;
        box-shadow:0 14px 34px rgba(13,27,42,0.16)!important;
      }
      .hero-floating-card{
        background:rgba(255,255,255,0.92)!important;
        border:1px solid rgba(13,27,42,0.08)!important;
        box-shadow:0 22px 54px rgba(13,27,42,0.18)!important;
        max-height: calc(100% - 84px);
        overflow:auto;
      }
      /* Keep metrics compact so the title + copy stays visible */
      .hero-floating-metrics{
        grid-template-columns:repeat(3,minmax(0,1fr))!important;
        gap:10px!important;
      }
      .hero-floating-metric{
        background:#fff!important;
        border:1px solid rgba(13,27,42,0.08)!important;
        padding:10px 10px 9px!important;
        border-radius:14px!important;
      }
      .hero-floating-metric div:first-child{
        font-size:16px!important;
      }
      .hero-floating-metric div:last-child{
        font-size:11px!important;
        line-height:1.35!important;
      }
      .hero-floating-metric div:last-child{
        color:var(--text-secondary)!important;
      }
      .hero-stats-wrap > *{min-width:calc(50% - 9px)!important}
      .cta-primary-premium,.cta-secondary-premium{width:100%!important}
      .plan-card-premium,.testi-shell,.section-shell-premium{border-radius:22px!important}
      .equip-card-content{padding:18px!important}
      .equip-card-price{padding:12px 14px!important}
      .equip-card-cta{width:100%!important;min-width:0!important}
      .hero-stats-wrap{gap:18px!important;margin-top:48px!important;padding-top:28px!important}
      .hero-cta-row{flex-direction:column!important;width:100%!important;align-items:stretch!important}
      .hero-cta-row > *{width:100%!important;max-width:360px!important;margin-left:auto!important;margin-right:auto!important}
      footer ul{flex-wrap:wrap!important;justify-content:center!important}
      .testi-card{flex-basis: 86vw}
    }
  `}</style>
);

// ── Sub-components ─────────────────────────────────────────────────────────

const CheckMark = () => (
  <span style={{
    width:18,height:18,flexShrink:0,borderRadius:"50%",
    background:"rgba(0,201,167,0.12)",display:"inline-flex",
    alignItems:"center",justifyContent:"center",marginTop:1
  }}>
    <span style={{
      display:"block",width:6,height:4,
      borderLeft:"1.5px solid var(--teal)",borderBottom:"1.5px solid var(--teal)",
      transform:"rotate(-45deg) translateY(-1px)"
    }}/>
  </span>
);

const StarRow = () => (
  <div style={{display:"flex",gap:3,marginBottom:14}}>
    {[...Array(5)].map((_,i)=>(
      <div key={i} style={{
        width:14,height:14,background:"var(--cyan)",
        clipPath:"polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)"
      }}/>
    ))}
  </div>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18">
    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
    <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
    <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.962L3.964 6.294C4.672 4.169 6.656 3.58 9 3.58z" fill="#EA4335"/>
  </svg>
);

// ── Reveal hook ────────────────────────────────────────────────────────────
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el = ref.current;
    if(!el) return;
    const obs = new IntersectionObserver(([entry])=>{
      if(entry.isIntersecting){ el.classList.add("visible"); obs.unobserve(el); }
    },{threshold:.1});
    obs.observe(el);
    return ()=>obs.disconnect();
  },[]);
  return ref;
}

// ── RevealDiv wrapper ──────────────────────────────────────────────────────
const Reveal = ({children,style,className=""}:{children:React.ReactNode;style?:React.CSSProperties;className?:string}) => {
  const ref = useReveal();
  return <div ref={ref} className={`reveal ${className}`} style={style}>{children}</div>;
};

// ── Landing sections (kept local for TS compatibility) ──────────────────────
function HeroSection({ onPrimaryCta }: { onPrimaryCta: () => void }) {
  const metrics = [
    { value: "3j", label: "Délai VIP garanti" },
    { value: "7j/7", label: "Support client dédié" },
    { value: "RGE", label: "Techniciens certifiés" },
  ];

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        padding: `calc(var(--header-h) + var(--hero-pt)) var(--container-px) var(--hero-pb)`,
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(circle at top right, rgba(0,184,220,0.10), transparent 28%), linear-gradient(180deg, #f9fbfd 0%, #ffffff 58%, #f7f9fc 100%)",
      }}
    >
      <div
        className="hero-blur"
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          pointerEvents: "none",
          filter: "blur(80px)",
          background: "radial-gradient(circle,rgba(0,184,220,0.12),transparent 70%)",
          top: -100,
          right: -100,
        }}
      />
      <div
        className="hero-blur"
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          pointerEvents: "none",
          filter: "blur(80px)",
          background: "radial-gradient(circle,rgba(0,201,167,0.10),transparent 70%)",
          bottom: -80,
          left: -80,
        }}
      />

      <div className="hero-grid">
        <div className="hero-copy">
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 18px",
              borderRadius: 50,
              background: "rgba(255,255,255,0.78)",
              border: "1px solid var(--border-cyan)",
              fontSize: 12,
              color: "var(--cyan)",
              fontWeight: 700,
              letterSpacing: ".06em",
              marginBottom: 22,
              textTransform: "uppercase",
              boxShadow: "0 10px 28px rgba(0,184,220,0.08)",
              animation: "fadeUp .5s ease both",
            }}
          >
            <div className="hero-badge-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cyan)" }} />
            RGE QualiPac · QualiSol certifié
          </div>

          <h1
            style={{
              fontFamily: "'DM Sans',sans-serif",
              fontSize: "clamp(38px,6vw,76px)",
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: "-2.4px",
              color: "var(--text)",
              maxWidth: 760,
              animation: "fadeUp .55s .08s ease both",
            }}
          >
            L’entretien premium qui garde vos équipements
            <span
              style={{
                display: "block",
                marginTop: 4,
                background: "linear-gradient(90deg,var(--cyan),var(--teal))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              performants, sûrs et suivis.
            </span>
          </h1>

          <p
            style={{
              marginTop: 22,
              fontSize: "clamp(15px,2.1vw,18px)",
              fontWeight: 400,
              color: "var(--text-secondary)",
              maxWidth: 580,
              lineHeight: 1.75,
              animation: "fadeUp .55s .16s ease both",
            }}
          >
            Contrat d’entretien complet pour pompes à chaleur, chauffe-eau, poêles à granule et installations solaires.
            Vous bénéficiez d’une prise en charge prioritaire, d’attestations officielles et d’un suivi clair dans votre
            espace client.
          </p>

          <div
            className="hero-cta-row"
            style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 34, animation: "fadeUp .55s .24s ease both" }}
          >
            <button
              type="button"
              onClick={onPrimaryCta}
              style={{
                padding: "15px 32px",
                borderRadius: 50,
                background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                color: "#fff",
                fontFamily: "'DM Sans',sans-serif",
                fontSize: 15,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                transition: "all .25s",
                boxShadow: "0 14px 34px rgba(0,184,220,0.28)",
              }}
            >
              Souscrire maintenant
            </button>
            <a
              href="#equipements"
              style={{
                padding: "15px 28px",
                borderRadius: 50,
                background: "rgba(255,255,255,0.82)",
                color: "var(--text)",
                fontFamily: "'DM Sans',sans-serif",
                fontSize: 15,
                fontWeight: 600,
                border: "1px solid rgba(13,27,42,0.10)",
                cursor: "pointer",
                textDecoration: "none",
                transition: "all .2s",
                boxShadow: "0 8px 24px rgba(13,27,42,0.06)",
              }}
            >
              Découvrir les installations
            </a>
          </div>

          <div
            style={{
              marginTop: 16,
              fontSize: 13,
              color: "var(--text-muted)",
              lineHeight: 1.6,
              animation: "fadeUp .55s .28s ease both",
            }}
          >
            Annulation facile après 6 mois · 14 jours de rétractation · Support 7j/7 · Documents disponibles en ligne
          </div>

          <div
            className="hero-stats-wrap"
            style={{
              display: "flex",
              gap: 22,
              flexWrap: "wrap",
              justifyContent: "flex-start",
              marginTop: 42,
              paddingTop: 26,
              borderTop: "1px solid rgba(13,27,42,0.08)",
              animation: "fadeUp .55s .32s ease both",
            }}
          >
            {[
              ["3j", "Délai VIP garanti"],
              ["7", "Installations couvertes"],
              ["100%", "Priorité abonnés"],
              ["RGE", "Techniciens certifiés"],
            ].map(([num, label]) => (
              <div
                key={num}
                style={{
                  minWidth: 110,
                  padding: "14px 16px",
                  borderRadius: 18,
                  background: "rgba(255,255,255,0.75)",
                  border: "1px solid rgba(13,27,42,0.06)",
                  boxShadow: "0 8px 22px rgba(13,27,42,0.05)",
                }}
              >
                <div
                  style={{
                    fontFamily: "'DM Sans',sans-serif",
                    fontSize: 28,
                    fontWeight: 800,
                    background: "linear-gradient(90deg,var(--cyan),var(--teal))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  {num}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.45 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="hero-visual-wrap" style={{ animation: "fadeUp .55s .16s ease both" }}>
          <div className="hero-visual-card">
            <img className="hero-visual-img" src="/technicien.jpg" alt="Technicien LabelEnergie sur installation solaire" />
            <div className="hero-visual-overlay" />
            <div className="hero-visual-pill">
              Intervention terrain · suivi certifié
            </div>

            <div className="hero-floating-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>
                    Espace client inclus
                  </div>
                  <div style={{ marginTop: 6, fontFamily: "'DM Sans',sans-serif", fontSize: 22, fontWeight: 800, color: "var(--text)", lineHeight: 1.1 }}>
                    Une maintenance plus visible,
                    <br />
                    plus simple à suivre.
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 200, lineHeight: 1.5 }}>
                  Contrats, documents, paiements et interventions réunis dans un seul espace.
                </div>
              </div>
              <div className="hero-floating-metrics">
                {metrics.map((metric) => (
                  <div key={metric.value} className="hero-floating-metric">
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{metric.value}</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.45 }}>{metric.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EquipementsSection({ onChoosePremium }: { onChoosePremium: () => void }) {
  const items = [
    {
      icon: "♨",
      name: "Pompe à chaleur Air/Eau & Air/Air",
      desc: "Vérification circuit frigorigène (attestation CERFA), nettoyage filtres, évaporateur et condenseur, contrôle sécurités haute/basse pression.",
      price: "19,90 €",
      unit: "À partir de /mois",
      wide: true,
      featured: true,
      image: "/pompe-chaleur-air-air.jpg",
      eyebrow: "Le plus demandé",
    },
    {
      icon: "🌡",
      name: "Chauffe-eau thermodynamique",
      desc: "Contrôle anode anti-corrosion, groupe de sécurité et paramètres de régulation pour sécuriser vos performances dans le temps.",
      price: "9,90 €",
      unit: "/mois",
      image: "/chauffe-thermodynamique.webp",
      eyebrow: "Entretien essentiel",
    },
    {
      icon: "☀",
      name: "Chauffe-eau solaire",
      desc: "Capteurs, circuit hydraulique, fluide caloporteur et pompe de circulation vérifiés à chaque visite annuelle.",
      price: "12,90 €",
      unit: "/mois",
      image: "/chauffe-solaire.webp",
      eyebrow: "Énergie solaire",
    },
    {
      icon: "🔥",
      name: "Poêle à granule",
      desc: "Nettoyage complet du foyer, contrôle de combustion et réglages fins pour un appareil fiable et propre.",
      price: "12,90 €",
      unit: "/mois",
      image: "/poele-a-granules.webp",
      eyebrow: "Confort quotidien",
    },
    {
      icon: "⚙",
      name: "Chaudière à granule",
      desc: "Analyse des fumées, réglage de combustion, organes hydrauliques et sécurités contrôlés avec méthode.",
      price: "24,90 €",
      unit: "/mois",
      image: "/chaudiere-a-granules.avif",
      eyebrow: "Usage intensif",
    },
    {
      icon: "◈",
      name: "Système solaire combiné",
      desc: "Capteurs, ballon, appoint et circuit hydraulique vérifiés pour maintenir une production stable toute l’année.",
      price: "24,90 €",
      unit: "/mois",
      image: "/systeme-solaire-combin.png",
      eyebrow: "Installation hybride",
    },
  ];

  return (
    <section id="equipements" style={{ padding: "var(--section-py) var(--container-px)", maxWidth: "var(--container-max)", margin: "0 auto" }}>
      <Reveal>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--cyan)", marginBottom: 10 }}>Équipements couverts</p>
        <h2 style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "clamp(26px,4vw,44px)", fontWeight: 700, letterSpacing: "-1px", lineHeight: 1.1, color: "var(--text)", marginBottom: 14 }}>
          Un contrat pour chaque installation
        </h2>
        <p style={{ fontSize: 16, color: "var(--text-secondary)", maxWidth: 720, lineHeight: 1.7, marginBottom: 18 }}>
          Inclus dans toutes les formules : <strong style={{ color: "var(--text)" }}>visite annuelle</strong>,{" "}
          <strong style={{ color: "var(--text)" }}>attestation officielle</strong>,{" "}
          <strong style={{ color: "var(--text)" }}>hotline dédiée</strong>.
        </p>
        <div
          className="equip-intro-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1.3fr) minmax(280px,.7fr)",
            gap: 18,
            alignItems: "stretch",
            marginTop: 24,
          }}
        >
          <div
            className="equip-intro-media"
            style={{
              position: "relative",
              minHeight: 260,
              borderRadius: 28,
              overflow: "hidden",
              boxShadow: "0 24px 60px rgba(13,27,42,0.10)",
            }}
          >
            <img
              src="/maison-technicien.jpg"
              alt="Technicien intervenant sur une installation résidentielle"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,20,32,0.06) 0%, rgba(8,20,32,0.64) 100%)" }} />
            <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", padding: 24, color: "#fff" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "fit-content", padding: "8px 12px", borderRadius: 999, background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.22)", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>
                Accompagnement sur mesure
              </div>
              <div style={{ marginTop: 14, fontFamily: "'DM Sans',sans-serif", fontSize: "clamp(22px,3vw,34px)", fontWeight: 800, lineHeight: 1.08 }}>
                Une formule claire,
                <br />
                pensée pour chaque installation.
              </div>
              <div style={{ marginTop: 10, maxWidth: 540, fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.86)" }}>
                Nous adaptons le niveau de couverture à votre équipement, à votre usage et à vos attentes de délai.
              </div>
            </div>
          </div>

          <div
            className="equip-intro-side"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 16,
              padding: 24,
              borderRadius: 28,
              background: "#fff",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--cyan)" }}>
                Recommandation rapide
              </div>
              <div style={{ marginTop: 8, fontFamily: "'DM Sans',sans-serif", fontSize: 24, fontWeight: 800, lineHeight: 1.1, color: "var(--text)" }}>
                Premium par défaut
              </div>
              <p style={{ marginTop: 10, fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.65 }}>
                La formule la plus équilibrée pour combiner sérénité, priorité d’intervention et budget maîtrisé.
              </p>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {["Visite annuelle incluse", "Attestation officielle fournie", "Support dédié 7j/7"].map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-secondary)" }}>
                  <CheckMark />
                  {item}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={onChoosePremium}
              className="cta-primary-premium"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: "13px 18px",
                borderRadius: 999,
                cursor: "pointer",
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              Voir ma formule recommandée
            </button>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="equip-grid" style={{ display: "grid", marginTop: 22 }}>
          {items.map((eq) => (
            <button
              key={eq.name}
              type="button"
              onClick={() => {
                const el = document.getElementById("formules");
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                onChoosePremium();
              }}
              className={`eq-card equip-card-premium${eq.wide ? " eq-wide" : ""}`}
              style={{
                textAlign: "left",
                background: "#fff",
                border: `1px solid ${eq.featured ? "rgba(0,184,220,0.22)" : "rgba(13,27,42,0.08)"}`,
                borderRadius: "var(--radius)",
                cursor: "pointer",
                boxShadow: eq.featured ? "0 24px 54px rgba(0,184,220,0.14)" : "0 18px 40px rgba(13,27,42,0.08)",
                gridColumn: eq.wide ? "span 2" : undefined,
              }}
              aria-label={`Voir les formules pour ${eq.name}`}
            >
              <img className="equip-card-img" src={eq.image} alt={eq.name} />
              <div className="equip-card-overlay" />
              <div className="equip-card-content">
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    width: "fit-content",
                    padding: "8px 12px",
                    borderRadius: 999,
                    background: eq.featured ? "rgba(0,184,220,0.18)" : "rgba(255,255,255,0.14)",
                    border: eq.featured ? "1px solid rgba(0,184,220,0.22)" : "1px solid rgba(255,255,255,0.14)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{eq.icon}</span>
                  {eq.eyebrow}
                </div>
                <div style={{ marginTop: 18, fontFamily: "'DM Sans',sans-serif", fontSize: eq.wide ? 28 : 24, fontWeight: 800, color: "#fff", lineHeight: 1.08 }}>
                  {eq.name}
                </div>
                <div style={{ marginTop: 10, fontSize: 14, color: "rgba(255,255,255,0.84)", lineHeight: 1.65, maxWidth: eq.wide ? 560 : 380 }}>
                  {eq.desc}
                </div>
                <div className="equip-card-bottom">
                  <div className="equip-card-price">
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.72)", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700 }}>
                      À partir de
                    </span>
                    <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 26, fontWeight: 800, color: "#fff", lineHeight: 1 }}>
                      {eq.price}
                    </div>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.78)" }}>{eq.unit}</span>
                  </div>
                  <span className="equip-card-cta">
                    Voir les formules
                    <span aria-hidden="true">→</span>
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function BrandMarqueeSection() {
  const brands = [
    { src: "/MARQUES/Ariston.png", alt: "Ariston" },
    { src: "/MARQUES/Atlantic.png", alt: "Atlantic" },
    { src: "/MARQUES/Chaffoteaux.png", alt: "Chaffoteaux" },
    { src: "/MARQUES/Daikin.png", alt: "Daikin" },
    { src: "/MARQUES/ENPHASE.png", alt: "Enphase" },
    { src: "/MARQUES/LG.png", alt: "LG" },
    { src: "/MARQUES/MAAF.png", alt: "MAAF" },
    { src: "/MARQUES/Orion.png", alt: "Orion" },
    { src: "/MARQUES/Panasonic.png", alt: "Panasonic" },
    { src: "/MARQUES/Stove%20Italia.png", alt: "Stove Italia" },
    { src: "/MARQUES/Thaleos.png", alt: "Thaleos" },
    { src: "/MARQUES/THOMSON%20ENERGY.png", alt: "Thomson Energy" },
  ];
  const doubled = [...brands, ...brands];

  return (
    <section aria-label="Marques partenaires" className="brand-strip" style={{ paddingLeft: "var(--container-px)", paddingRight: "var(--container-px)" }}>
      <div style={{ maxWidth: "var(--container-max)", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)" }}>
            Marques couvertes & partenaires
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Compatibilités larges · standards RGE</div>
        </div>
        <div className="brand-marquee" style={{ marginTop: 10 }}>
          <div className="brand-track" aria-hidden="true">
            {doubled.map((b, idx) => (
              <img key={`${b.src}-${idx}`} className="brand-item" src={b.src} alt={b.alt} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FormulesSection({
  onChooseStandard,
  onChoosePremium,
  onChooseVip,
}: {
  onChooseStandard: () => void;
  onChoosePremium: () => void;
  onChooseVip: () => void;
}) {
  const plans = [
    {
      name: "Standard",
      badge: "Essentiel",
      price: "À partir de 9,90 €",
      note: "Selon équipement",
      summary: "Pour garder l’essentiel sous contrôle avec une visite annuelle et une priorité d’intervention.",
      features: [
        "1 visite annuelle préventive",
        "2 dépannages/an par équipement",
        "Délai d'intervention sous 7 jours ouvrés",
        "Attestation d'entretien officielle",
        "Accès hotline 01 81 72 39 59",
      ],
      action: onChooseStandard,
      cta: "Choisir Standard",
      tone: "default" as const,
    },
    {
      name: "Premium",
      badge: "Le plus choisi",
      price: "À partir de 14,90 €",
      note: "Ex. PAC air/eau : 24,90 €/mois",
      summary: "Le meilleur équilibre entre sérénité, rapidité d’intervention et confort de suivi au quotidien.",
      features: [
        "1 visite annuelle préventive",
        "3 dépannages/an par équipement",
        "Délai d'intervention sous 5 jours ouvrés",
        "Priorité renforcée — tête de file",
        "−10% sur pièces de rechange",
        "Hotline directe technicien senior",
      ],
      action: onChoosePremium,
      cta: "Choisir Premium",
      tone: "recommended" as const,
    },
    {
      name: "VIP",
      badge: "Accompagnement maximal",
      price: "À partir de 19,90 €",
      note: "Ex. PAC air/eau : 34,90 €/mois",
      summary: "Pour les clients qui veulent une prise en charge prioritaire avec le niveau de service le plus élevé.",
      features: [
        "1 visite annuelle préventive",
        "Dépannages illimités en usage normal",
        "Délai d'intervention sous 3 jours ouvrés",
        "Priorité absolue — premier servi",
        "−30% sur les pièces de rechange",
        "Main-d'œuvre dépannage incluse",
      ],
      action: onChooseVip,
      cta: "Choisir VIP",
      tone: "default" as const,
    },
  ];

  return (
    <div id="formules" style={{ background: "var(--bg2)", padding: "var(--section-py) var(--container-px)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <Reveal style={{ textAlign: "center" }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--cyan)", marginBottom: 10 }}>Formules d'entretien</p>
          <h2 style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "clamp(26px,4vw,44px)", fontWeight: 700, letterSpacing: "-1px", lineHeight: 1.1, color: "var(--text)", marginBottom: 14 }}>
            Standard · Premium · VIP
          </h2>
          <p style={{ fontSize: 16, color: "var(--text-secondary)", maxWidth: 620, lineHeight: 1.7, margin: "0 auto 52px" }}>
            Trois niveaux de couverture, une même exigence de qualité: lisibilité, priorité d’intervention et suivi premium.
          </p>
        </Reveal>

       

        <Reveal>
          <div className="plans-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18, alignItems: "start" }}>
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`plan-card plan-card-premium${plan.tone === "recommended" ? " is-recommended" : ""}`}
                style={{
                  background: plan.tone === "recommended"
                    ? "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,250,252,0.96))"
                    : "#fff",
                  border: plan.tone === "recommended" ? "1.5px solid var(--cyan)" : "1px solid rgba(13,27,42,0.08)",
                  padding: "32px 28px",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 12px",
                    borderRadius: 999,
                    background: plan.tone === "recommended" ? "rgba(0,184,220,0.12)" : "var(--bg2)",
                    border: plan.tone === "recommended" ? "1px solid rgba(0,184,220,0.18)" : "1px solid rgba(13,27,42,0.06)",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: plan.tone === "recommended" ? "var(--cyan)" : "var(--text-muted)",
                    marginBottom: 18,
                  }}
                >
                  {plan.badge}
                </div>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>
                  {plan.name}
                </div>
                <div style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 24, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>
                  {plan.price}
                  {plan.name === "Standard" ? <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>/mois</span> : null}
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>{plan.note}</div>
                <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.65, marginBottom: 20 }}>{plan.summary}</div>
                <div style={{ height: 1, background: "rgba(13,27,42,0.08)", margin: "20px 0" }} />
                <div style={{ display: "grid", gap: 11 }}>
                  {plan.features.map((feature) => (
                    <div key={feature} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                      <CheckMark />
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={plan.action}
                  className={plan.tone === "recommended" ? "cta-primary-premium" : "cta-secondary-premium"}
                  style={{ width: "100%", marginTop: 24 }}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal style={{ marginTop: 16, padding: "18px 24px", background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", gap: 14, boxShadow: "var(--shadow-sm)" }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(0,201,167,0.1)", border: "1px solid rgba(0,201,167,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--teal)", fontWeight: 700 }}>
            ✓
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Tarif garanti sans augmentation la 1ère année</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>Engagement ferme de LabelEnergie à la signature, quel que soit l'évolution des indices.</div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function TestimonialsSection() {
  const items = [
    { initials: "MB", name: "Marie-Brigitte L.", loc: "Val-de-Marne · Abonnée VIP", text: "Pompe à chaleur tombée en panne un vendredi soir. Le technicien était là le samedi matin. Impossible sans le contrat VIP." },
    { initials: "JR", name: "Jacques R.", loc: "Seine-et-Marne · Premium depuis 4 ans", text: "L'attestation d'entretien m'a sauvé lors d'un litige avec mon assureur. Document officiel, aucune discussion." },
    { initials: "SC", name: "Sophie C.", loc: "Essonne · Standard depuis 2 ans", text: "L'attestation d'entretien et la visite annuelle m'ont évité des mauvaises surprises. Simple, clair et tout est dans l'espace client." },
  ];
  const doubled = [...items, ...items];

  return (
    <div style={{ background: "var(--bg2)", padding: "var(--section-py) var(--container-px)" }}>
      <div className="testi-shell" style={{ width: "100%", padding: "38px 0" }}>
        <Reveal style={{ textAlign: "center", marginBottom: 52, maxWidth: "var(--container-max)", marginLeft: "auto", marginRight: "auto" }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--cyan)", marginBottom: 10 }}>Témoignages clients</p>
          <h2 style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "clamp(26px,4vw,44px)", fontWeight: 700, letterSpacing: "-1px", lineHeight: 1.1, color: "var(--text)" }}>
            Ils nous font confiance
          </h2>
          <p style={{ marginTop: 14, fontSize: 16, color: "var(--text-secondary)", maxWidth: 620, lineHeight: 1.7, marginLeft: "auto", marginRight: "auto" }}>
            Une expérience terrain sérieuse, lisible et rassurante. Chaque avis met en avant la réactivité et la qualité du suivi.
          </p>
        </Reveal>

        <Reveal>
          <div className="testi-marquee" aria-label="Témoignages clients (défilement automatique)">
            <div className="testi-track">
              {doubled.map((item, i) => (
                <div
                  key={`${item.initials}-${i}`}
                  className="testi-card testi-card-premium"
                  style={{ borderRadius: "var(--radius)", padding: 28 }}
                >
                  <StarRow />
                  <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 18, fontStyle: "italic" }}>
                    "{item.text}"
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--cyan-10)", border: "1px solid var(--border-cyan)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "var(--cyan)" }}>
                      {item.initials}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{item.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{item.loc}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

// ── Modal Component ────────────────────────────────────────────────────────
interface ModalProps {
  isOpen: boolean;
  initialTab: AuthTab;
  onClose: ()=>void;
  onAuthed?: (user: FirebaseUser) => void;
  redirectToPortal?: boolean;
}

const PORTAL_USERS_COL = "client_portal_users";
const CRM_CLIENTS_COL = "clients";
const CLIENT_ENTRETIEN_COL = "client_entretien";
const MAINTENANCES_COL = "maintenances";

type ClientSource = "clients" | "client_entretien";

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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

type MaintenanceLike = {
  clientContact?: { email?: string; firstName?: string; lastName?: string; phone?: string };
  signerEmail?: string;
};

async function findProfileByEmail(email: string): Promise<{ id: string; client: CRMClient; source: ClientSource } | null> {
  // 1) Collection clients (projets A à Z)
  {
    const ref = collection(db, CRM_CLIENTS_COL);
    const q = query(ref, where("contact.email", "==", email));
    const snap = await getDocsTracked(q, "findProfileByEmail:clientsByEmail");
    if (!snap.empty) return { id: snap.docs[0].id, client: snap.docs[0].data() as CRMClient, source: "clients" };
  }

  // 2) Collection client_entretien (nouveaux clients portail / entretien)
  {
    const ref = collection(db, CLIENT_ENTRETIEN_COL);
    const q = query(ref, where("contact.email", "==", email));
    const snap = await getDocsTracked(q, "findProfileByEmail:clientEntretienByEmail");
    if (!snap.empty) return { id: snap.docs[0].id, client: snap.docs[0].data() as CRMClient, source: "client_entretien" };
  }

  // 3) Fallback : maintenances (certains clients existent uniquement ici)
  {
    const ref = collection(db, MAINTENANCES_COL);
    const q1 = query(ref, where("clientContact.email", "==", email));
    const snap1 = await getDocsTracked(q1, "findProfileByEmail:maintenancesByClientContactEmail");
    if (!snap1.empty) {
      const m = snap1.docs[0].data() as MaintenanceLike;
      return {
        id: `maintenance_email:${email}`,
        source: "client_entretien",
        client: {
          contact: {
            email,
            firstName: m.clientContact?.firstName,
            lastName: m.clientContact?.lastName,
            phone: m.clientContact?.phone
          }
        }
      };
    }

    const q2 = query(ref, where("signerEmail", "==", email));
    const snap2 = await getDocsTracked(q2, "findProfileByEmail:maintenancesBySignerEmail");
    if (!snap2.empty) {
      const m = snap2.docs[0].data() as MaintenanceLike;
      return {
        id: `maintenance_signer:${email}`,
        source: "client_entretien",
        client: {
          contact: {
            email,
            firstName: m.clientContact?.firstName,
            lastName: m.clientContact?.lastName,
            phone: m.clientContact?.phone
          }
        }
      };
    }
  }

  return null;
}

async function createMinimalCRMClient(payload: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}): Promise<string> {
  // UI actuelle ne demande pas l'adresse complète, donc on crée un client minimal.
  const now = new Date();
  const fullName = `${payload.firstName} ${payload.lastName}`.trim();

  const clientData = {
    name: fullName || "Client",
    contact: {
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      phone: payload.phone
    },
    address: {
      street: payload.street ?? "",
      postalCode: payload.postalCode ?? "",
      city: payload.city ?? "",
      country: payload.country ?? "France"
    },
    regie: undefined,
    status: "entretien",
    createdAt: now,
    updatedAt: now,
    productsIds: [],
    installation: {
      totalTime: 0,
      durationInHours: 0,
      durationInDays: 0,
      durationText: "0h"
    },
    RAC: {
      hasToCollect: false,
      amount: 0
    },
    comment: "",
    tag: null,
    team: null,
    searchIndex: [payload.firstName, payload.lastName, payload.email, payload.phone, fullName].filter(Boolean)
  };

  const clientRef = await addDoc(collection(db, CRM_CLIENTS_COL), clientData);
  await setDoc(doc(db, CRM_CLIENTS_COL, clientRef.id), { id: clientRef.id }, { merge: true });
  return clientRef.id;
}

async function createMinimalClientEntretien(payload: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}): Promise<string> {
  const now = new Date();
  const fullName = `${payload.firstName} ${payload.lastName}`.trim();

  const clientData = {
    name: fullName || "Client entretien",
    contact: {
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      phone: payload.phone
    },
    address: {
      street: payload.street ?? "",
      postalCode: payload.postalCode ?? "",
      city: payload.city ?? "",
      country: payload.country ?? "France"
    },
    createdAt: now,
    updatedAt: now,
    status: "entretien"
  };

  const ref = await addDoc(collection(db, CLIENT_ENTRETIEN_COL), clientData);
  await setDoc(doc(db, CLIENT_ENTRETIEN_COL, ref.id), { id: ref.id }, { merge: true });
  return ref.id;
}

async function upsertPortalUser(authUser: FirebaseUser, email: string, payload: { clientId: string; clientSource: ClientSource }) {
  const portalUserRef = doc(db, PORTAL_USERS_COL, authUser.uid);
  await setDoc(
    portalUserRef,
    {
      authUid: authUser.uid,
      email,
      clientId: payload.clientId,
      clientSource: payload.clientSource,
      createdAt: new Date().toISOString()
    },
    { merge: true }
  );
}

async function ensurePortalUserForAuthUser(authUser: FirebaseUser): Promise<string> {
  const email = authUser.email;
  if (!email) throw new Error("Email utilisateur non disponible.");

  const existing = await getDocTracked(doc(db, PORTAL_USERS_COL, authUser.uid), "ensurePortalUser:portalUserByUid");
  if (existing.exists()) {
    const data = existing.data() as { clientId?: string };
    if (data.clientId) return data.clientId;
  }

  const found = await findProfileByEmail(email);
  if (!found) {
    // On n'auto-crée pas ici (sinon un login Google créerait des "fantômes").
    throw new Error("Aucun profil trouvé pour cet email. Veuillez créer un compte.");
  }

  // Si ça vient du fallback maintenances, on crée un vrai doc dans client_entretien pour stabiliser l'identité.
  let stableId = found.id;
  let stableSource: ClientSource = found.source;
  if (found.source === "client_entretien" && (found.id.startsWith("maintenance_") || found.id.startsWith("maintenance"))) {
    const firstName = found.client.contact?.firstName ?? "";
    const lastName = found.client.contact?.lastName ?? "";
    const phone = found.client.contact?.phone ?? "";
    stableId = await createMinimalClientEntretien({
      firstName,
      lastName,
      email,
      phone,
      country: found.client.address?.country ?? "France"
    });
    stableSource = "client_entretien";
  }

  await upsertPortalUser(authUser, email, { clientId: stableId, clientSource: stableSource });
  return stableId;
}

function AuthModal({isOpen,initialTab,onClose,onAuthed,redirectToPortal=true}:ModalProps){
  const navigate = useNavigate();
  const [tab,setTab]=useState<AuthTab>(initialTab);
  const [loginEmail,setLoginEmail]=useState("");
  const [loginPass,setLoginPass]=useState("");
  type LoginStep = "email" | "password";
  const [loginStep,setLoginStep]=useState<LoginStep>("email");
  const [showLoginPass,setShowLoginPass]=useState(false);
  const [loginLoading,setLoginLoading]=useState(false);
  const [loginError,setLoginError]=useState<string | null>(null);
  const [googleLoading,setGoogleLoading]=useState(false);

  type SignupStep = "email" | "details";
  const [signupStep, setSignupStep] = useState<SignupStep>("email");
  const [signupProfileLocked, setSignupProfileLocked] = useState(false);
  const [signupLockedEmail, setSignupLockedEmail] = useState<string | null>(null);
  const [signupPrefillLoading, setSignupPrefillLoading] = useState(false);
  const [signupPrefillError, setSignupPrefillError] = useState<string | null>(null);
  const [signupError, setSignupError] = useState<string | null>(null);

  const [signupPrenom,setSignupPrenom]=useState("");
  const [signupNom,setSignupNom]=useState("");
  const [signupEmail,setSignupEmail]=useState("");
  const [signupTel,setSignupTel]=useState("");
  const [signupStreet, setSignupStreet] = useState("");
  const [signupPostalCode, setSignupPostalCode] = useState("");
  const [signupCity, setSignupCity] = useState("");
  const [signupPass,setSignupPass]=useState("");
  const [showSignupPass,setShowSignupPass]=useState(false);
  const [signupCgv,setSignupCgv]=useState(false);
  const [signupLoading,setSignupLoading]=useState(false);
  const [signupSuccess,setSignupSuccess]=useState(false);
  const [strength,setStrength]=useState<PasswordStrength>({width:"0%",color:"transparent",label:""});
  const [shaking,setShaking]=useState(false);

  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{ if(isOpen) setTab(initialTab); },[isOpen,initialTab]);

  useEffect(()=>{
    const handler=(e:KeyboardEvent)=>{ if(e.key==="Escape") onClose(); };
    document.addEventListener("keydown",handler);
    return ()=>document.removeEventListener("keydown",handler);
  },[onClose]);

  useEffect(()=>{
    document.body.style.overflow = isOpen?"hidden":"";
    return ()=>{ document.body.style.overflow=""; };
  },[isOpen]);

  useEffect(()=>{
    if(isOpen && tab==="login"){
      setLoginStep("email");
      setLoginError(null);
      setShowLoginPass(false);
    }
  },[isOpen,tab]);

  useEffect(()=>{
    if(isOpen && tab==="signup"){
      setSignupStep("email");
      setSignupProfileLocked(false);
      setSignupLockedEmail(null);
      setSignupPrefillLoading(false);
      setSignupPrefillError(null);
      setSignupError(null);

      setSignupPrenom("");
      setSignupNom("");
      setSignupEmail("");
      setSignupTel("");
      setSignupStreet("");
      setSignupPostalCode("");
      setSignupCity("");
      setSignupPass("");
      setShowSignupPass(false);
      setSignupCgv(false);
      setStrength({ width: "0%", color: "transparent", label: "" });
    }
  },[isOpen,tab]);

  function shake(){
    if(shaking) return;
    setShaking(true);
    setTimeout(()=>setShaking(false),400);
  }

  function checkStrength(v:string){
    let s=0;
    if(v.length>=8)s++;
    if(/[A-Z]/.test(v))s++;
    if(/[0-9]/.test(v))s++;
    if(/[^A-Za-z0-9]/.test(v))s++;
    const lv=[
      {width:"0%",color:"transparent",label:""},
      {width:"25%",color:"#E24B4A",label:"Faible"},
      {width:"50%",color:"#EF9F27",label:"Moyen"},
      {width:"75%",color:"#00B8DC",label:"Bon"},
      {width:"100%",color:"#00C9A7",label:"Excellent"},
    ];
    setStrength(lv[s]);
  }

  async function handleLogin(){
    const email = loginEmail.trim().toLowerCase();
    const pass = loginPass;
    if(!email || !pass || !isValidEmail(email)){
      setLoginError("Mot de passe ou mail incorrecte.");
      shake();
      return;
    }

    setLoginLoading(true);
    setLoginError(null);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, pass);
      await ensurePortalUserForAuthUser(userCredential.user);
      onAuthed?.(userCredential.user);
      onClose();
      if(redirectToPortal) navigate("/client-portal");
    } catch (err) {
      console.error("[portal] login error:", err);
      const code = (err as any)?.code as string | undefined;
      // On masque les détails pour ne pas révéler si le compte existe,
      // MAIS on aide le cas fréquent : "client CRM existant" sans compte Firebase.
      if (code === "auth/user-not-found") {
        setLoginError("Première connexion : veuillez créer un compte avec cet email (définissez un mot de passe).");
      } else {
        setLoginError("Mot de passe ou mail incorrecte.");
      }
      shake();
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleForgotPassword() {
    const email = loginEmail.trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      setLoginError("Veuillez saisir une adresse e-mail valide.");
      shake();
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setLoginError("Si un compte existe, un email de réinitialisation vient d’être envoyé.");
    } catch (err) {
      console.error("[portal] password reset error:", err);
      // Toujours message générique (évite l'énumération de comptes).
      setLoginError("Si un compte existe, un email de réinitialisation vient d’être envoyé.");
    }
  }

  function handleContinueEmail() {
    const email = loginEmail.trim().toLowerCase();
    if(!email || !isValidEmail(email)){
      setLoginError("Mot de passe ou mail incorrecte.");
      shake();
      return;
    }

    setLoginError(null);
    setLoginStep("password");
  }

  async function handleSignup(){
    const email = signupEmail.trim().toLowerCase();
    if(!signupPrenom || !signupNom || !email || !signupPass || !signupCgv || !signupTel){
      setSignupError("Mot de passe ou mail incorrecte.");
      shake();
      return;
    }
    if(!isValidEmail(email)){
      setSignupError("Mot de passe ou mail incorrecte.");
      shake();
      return;
    }
    if(signupPass.length < 8){
      setSignupError("Mot de passe trop court (min 8 caractères).");
      shake();
      return;
    }

    setSignupLoading(true);
    setSignupError(null);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, signupPass);
      const found = await findProfileByEmail(email);

      // Règle métier : nouveaux clients => client_entretien (pas clients)
      // Si existe déjà dans clients, on map vers clients. Sinon, on map vers client_entretien.
      const clientSource: ClientSource = found?.source ?? "client_entretien";

      const clientId =
        found?.source === "clients"
          ? found.id
          : found?.source === "client_entretien"
            ? found.id.startsWith("maintenance") ? await createMinimalClientEntretien({
                firstName: signupPrenom,
                lastName: signupNom,
                email,
                phone: signupTel,
                street: signupStreet,
                postalCode: signupPostalCode,
                city: signupCity,
                country: "France"
              }) : found.id
            : await createMinimalClientEntretien({
                firstName: signupPrenom,
                lastName: signupNom,
                email,
                phone: signupTel,
                street: signupStreet,
                postalCode: signupPostalCode,
                city: signupCity,
                country: "France"
              });

      await upsertPortalUser(userCredential.user, email, { clientId, clientSource });
      onAuthed?.(userCredential.user);
      onClose();
      if(redirectToPortal) navigate("/client-portal");
    } catch (err) {
      console.error("[portal] signup error:", err);
      const code = (err as any)?.code as string | undefined;
      if (code === "auth/email-already-in-use") {
        // Si le compte Firebase existe déjà, on tente une connexion (cas: l'utilisateur se trompe de tab).
        try {
          const userCredential = await signInWithEmailAndPassword(auth, email, signupPass);
          await ensurePortalUserForAuthUser(userCredential.user);
          onAuthed?.(userCredential.user);
          onClose();
          if(redirectToPortal) navigate("/client-portal");
          return;
        } catch (innerErr) {
          console.error("[portal] signup->login fallback error:", innerErr);
        }
        setSignupError("Un compte existe déjà pour cet email. Utilisez l’onglet Connexion ou “Mot de passe oublié”.");
        shake();
        return;
      }

      setSignupError("Mot de passe ou mail incorrecte.");
      shake();
    } finally {
      setSignupLoading(false);
    }
  }

  async function handleGoogleLogin(){
    setGoogleLoading(true);
    setSignupSuccess(false);
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      await ensurePortalUserForAuthUser(result.user);
      onAuthed?.(result.user);
      onClose();
      if(redirectToPortal) navigate("/client-portal");
    } catch (err) {
      console.error("[portal] google login error:", err);
      window.alert(err instanceof Error ? err.message : "Erreur Google OAuth");
      shake();
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleContinueSignupEmail() {
    const email = signupEmail.trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      setSignupPrefillError("Adresse e-mail invalide.");
      shake();
      return;
    }

    setSignupPrefillLoading(true);
    setSignupPrefillError(null);
    setSignupError(null);

    try {
      const found = await findProfileByEmail(email);
      if (found) {
        setSignupProfileLocked(true);
        setSignupLockedEmail(email);
        setSignupEmail(email);
        setSignupPrenom(found.client.contact?.firstName ?? "");
        setSignupNom(found.client.contact?.lastName ?? "");
        setSignupTel(found.client.contact?.phone ?? "");
        setSignupStreet(found.client.address?.street ?? "");
        setSignupPostalCode(found.client.address?.postalCode ?? "");
        setSignupCity(found.client.address?.city ?? "");
      } else {
        // Pas de client CRM pour cet email => on laisse l'utilisateur compléter.
        setSignupProfileLocked(false);
        setSignupLockedEmail(null);
        setSignupPrenom("");
        setSignupNom("");
        setSignupTel("");
        setSignupStreet("");
        setSignupPostalCode("");
        setSignupCity("");
      }
      setSignupStep("details");
    } catch (err) {
      console.error("[portal] signup prefill error:", err);
      setSignupPrefillError("Erreur de chargement des informations. Vous pouvez compléter manuellement.");
      setSignupProfileLocked(false);
      setSignupLockedEmail(null);
      setSignupStep("details");
    } finally {
      setSignupPrefillLoading(false);
    }
  }

  if(!isOpen) return null;

  return (
    <div
      style={{
        position:"fixed",inset:0,zIndex:1000,background:"rgba(13,27,42,0.45)",
        backdropFilter:"blur(6px)",display:"flex",alignItems:"center",
        justifyContent:"center",padding:20,animation:"overlayIn .2s ease"
      }}
      onClick={(e)=>{ if(e.target===e.currentTarget) onClose(); }}
    >
      <div
        ref={boxRef}
        className={shaking?"shake-anim":""}
        style={{
          background:"#fff",borderRadius:24,
          boxShadow:"0 24px 80px rgba(0,0,0,0.18),0 4px 16px rgba(0,0,0,0.08)",
          width:"100%",maxWidth:480,animation:"modalIn .25s ease",
          overflow:"hidden",position:"relative"
        }}
      >
        <div style={{height:5,background:"linear-gradient(90deg,var(--cyan),var(--teal))"}}/>
        <button
          onClick={onClose}
          style={{
            position:"absolute",top:18,right:18,width:32,height:32,
            borderRadius:"50%",background:"var(--bg2)",border:"1px solid var(--border)",
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:18,color:"var(--text-muted)",transition:"all .2s",lineHeight:1,zIndex:2,
            padding:0,fontFamily:"inherit"
          }}
        >×</button>

        <div className="modal-body-pad" style={{padding:"36px 40px 40px"}}>
          {/* Tabs */}
          <div style={{display:"flex",background:"var(--bg2)",borderRadius:12,padding:4,marginBottom:32}}>
            {(["login","signup"] as AuthTab[]).map(t=>(
              <button
                key={t}
                onClick={()=>setTab(t)}
                style={{
                  flex:1,padding:9,borderRadius:9,textAlign:"center",
                  fontFamily:"'DM Sans',sans-serif",fontSize:14,
                  color:tab===t?"var(--text)":"var(--text-muted)",
                  border:"none",background:tab===t?"#fff":"transparent",
                  cursor:"pointer",transition:"all .2s",
                  fontWeight:tab===t?500:400,
                  boxShadow:tab===t?"0 1px 6px rgba(0,0,0,0.08)":"none"
                }}
              >{t==="login"?"Connexion":"Créer un compte"}</button>
            ))}
          </div>

          {/* LOGIN PANEL */}
          {tab==="login" && (
            <div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:22,fontWeight:700,letterSpacing:"-.5px",color:"var(--text)",marginBottom:6}}>Content de vous revoir</div>
              <div style={{fontSize:14,color:"var(--text-muted)",marginBottom:28,lineHeight:1.5}}>Accédez à votre espace client LabelEnergie pour gérer vos contrats et interventions.</div>
              {loginStep==="email" ? (
                <>
                  <FieldInput
                    label="Adresse e-mail"
                    type="email"
                    placeholder="vous@exemple.fr"
                    value={loginEmail}
                    onChange={setLoginEmail}
                    autoComplete="email"
                  />
                  <SubmitButton
                    loading={false}
                    onClick={handleContinueEmail}
                    label="Continuer"
                    loadingLabel="Continuer…"
                  />
                  {loginError && (
                    <div style={{marginTop:12,fontSize:13,color:"#E24B4A",lineHeight:1.4}}>
                      {loginError}
                    </div>
                  )}
                  <div style={{textAlign:"center",fontSize:13,color:"var(--text-muted)",marginTop:18}}>
                    Pas encore de compte ?{" "}
                    <a
                      onClick={()=>{
                        setTab("signup");
                        setLoginStep("email");
                        setLoginError(null);
                      }}
                      style={{color:"var(--cyan)",textDecoration:"none",fontWeight:500,cursor:"pointer"}}
                    >
                      Créer un compte
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <FieldInput
                    label="Adresse e-mail"
                    type="email"
                    placeholder="vous@exemple.fr"
                    value={loginEmail}
                    onChange={setLoginEmail}
                    autoComplete="email"
                  />
                  <div style={{marginBottom:16}}>
                    <label style={{display:"block",fontSize:13,fontWeight:500,color:"var(--text-secondary)",marginBottom:6}}>Mot de passe</label>
                    <PasswordInput
                      id="login-pass"
                      placeholder="••••••••"
                      value={loginPass}
                      onChange={setLoginPass}
                      show={showLoginPass}
                      onToggle={()=>setShowLoginPass(p=>!p)}
                      autoComplete="current-password"
                    />
                  </div>
                  <SubmitButton loading={loginLoading} onClick={handleLogin} label="Se connecter" loadingLabel="Connexion…"/>
                  <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}>
                    <a
                      onClick={handleForgotPassword}
                      style={{fontSize:13,color:"var(--cyan)",textDecoration:"none",cursor:"pointer"}}
                    >
                      Mot de passe oublié ?
                    </a>
                  </div>
                  {loginError && (
                    <div style={{marginTop:12,fontSize:13,color:"#E24B4A",lineHeight:1.4}}>
                      {loginError}
                    </div>
                  )}
                  <div style={{textAlign:"center",fontSize:13,color:"var(--text-muted)",marginTop:18}}>
                    Pas encore de compte ?{" "}
                    <a
                      onClick={()=>{
                        setTab("signup");
                        setLoginStep("email");
                        setLoginError(null);
                        // Pré-remplir l'email côté signup si déjà saisi.
                        if (loginEmail.trim()) setSignupEmail(loginEmail.trim().toLowerCase());
                      }}
                      style={{color:"var(--cyan)",textDecoration:"none",fontWeight:500,cursor:"pointer"}}
                    >
                      Créer un compte
                    </a>
                  </div>
                </>
              )}
            </div>
          )}

          {/* SIGNUP PANEL */}
          {tab==="signup" && (
            <div>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:22,fontWeight:700,letterSpacing:"-.5px",color:"var(--text)",marginBottom:6}}>Créer votre espace client</div>
              <div style={{fontSize:14,color:"var(--text-muted)",marginBottom:28,lineHeight:1.5}}>Gérez vos contrats, suivez vos interventions et accédez à vos attestations en ligne.</div>
              {!signupSuccess ? (
                <>
                  {signupStep === "email" && (
                    <>
                      <FieldInput
                        label="Adresse e-mail"
                        type="email"
                        placeholder="vous@exemple.fr"
                        value={signupEmail}
                        onChange={setSignupEmail}
                        autoComplete="email"
                        disabled={signupPrefillLoading}
                      />
                      <SubmitButton
                        loading={signupPrefillLoading}
                        onClick={handleContinueSignupEmail}
                        label="Continuer"
                        loadingLabel="Vérification…"
                      />

                      <OrDivider />
                      <SocialButton onClick={handleGoogleLogin} loading={googleLoading} />

                      {signupPrefillError && (
                        <div style={{marginTop:12,fontSize:13,color:"#E24B4A",lineHeight:1.4}}>
                          {signupPrefillError}
                        </div>
                      )}
                      <div style={{textAlign:"center",fontSize:13,color:"var(--text-muted)",marginTop:18}}>
                        Vous avez déjà un compte ?{" "}
                        <a onClick={()=>setTab("login")} style={{color:"var(--cyan)",textDecoration:"none",fontWeight:500,cursor:"pointer"}}>
                          Se connecter
                        </a>
                      </div>
                    </>
                  )}

                  {signupStep === "details" && (
                    <>
                      <div className="field-row-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <FieldInput
                          label="Prénom"
                          type="text"
                          placeholder="Jean"
                          value={signupPrenom}
                          onChange={setSignupPrenom}
                          autoComplete="given-name"
                          disabled={signupProfileLocked || signupPrefillLoading}
                        />
                        <FieldInput
                          label="Nom"
                          type="text"
                          placeholder="Dupont"
                          value={signupNom}
                          onChange={setSignupNom}
                          autoComplete="family-name"
                          disabled={signupProfileLocked || signupPrefillLoading}
                        />
                      </div>

                      <FieldInput
                        label="Adresse e-mail"
                        type="email"
                        placeholder="vous@exemple.fr"
                        value={signupEmail}
                        onChange={(v) => {
                          const next = v.trim().toLowerCase();
                          setSignupEmail(next);
                          if (signupProfileLocked && signupLockedEmail && next !== signupLockedEmail) {
                            // L'utilisateur change l'email après un pré-remplissage :
                            // on déverrouille et on évite de conserver des infos d'un autre profil.
                            setSignupProfileLocked(false);
                            setSignupLockedEmail(null);
                            setSignupPrenom("");
                            setSignupNom("");
                            setSignupTel("");
                            setSignupStreet("");
                            setSignupPostalCode("");
                            setSignupCity("");
                          }
                        }}
                        autoComplete="email"
                        disabled={signupPrefillLoading}
                      />

                      <FieldInput
                        label="Téléphone"
                        type="tel"
                        placeholder="06 12 34 56 78"
                        value={signupTel}
                        onChange={setSignupTel}
                        autoComplete="tel"
                        disabled={signupProfileLocked || signupPrefillLoading}
                      />

                      <FieldInput
                        label="Adresse"
                        type="text"
                        placeholder="12 rue Exemple"
                        value={signupStreet}
                        onChange={setSignupStreet}
                        autoComplete="street-address"
                        disabled={signupProfileLocked || signupPrefillLoading}
                      />

                      <div className="field-row-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        <FieldInput
                          label="Code Postal"
                          type="text"
                          placeholder="75001"
                          value={signupPostalCode}
                          onChange={setSignupPostalCode}
                          autoComplete="postal-code"
                          disabled={signupProfileLocked || signupPrefillLoading}
                        />
                        <FieldInput
                          label="Ville"
                          type="text"
                          placeholder="Paris"
                          value={signupCity}
                          onChange={setSignupCity}
                          autoComplete="address-level2"
                          disabled={signupProfileLocked || signupPrefillLoading}
                        />
                      </div>

                      <div style={{marginBottom:16}}>
                        <label style={{display:"block",fontSize:13,fontWeight:500,color:"var(--text-secondary)",marginBottom:6}}>Mot de passe</label>
                        <PasswordInput
                          id="signup-pass"
                          placeholder="8 caractères minimum"
                          value={signupPass}
                          onChange={v=>{setSignupPass(v);checkStrength(v);}}
                          show={showSignupPass}
                          onToggle={()=>setShowSignupPass(p=>!p)}
                          autoComplete="new-password"
                        />
                        <div style={{height:3,borderRadius:2,background:"var(--border)",marginTop:8,overflow:"hidden"}}>
                          <div style={{height:"100%",width:strength.width,borderRadius:2,transition:"width .3s,background .3s",background:strength.color}}/>
                        </div>
                        <div style={{fontSize:12,color:strength.color,marginTop:4}}>{strength.label}</div>
                      </div>

                      <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:20}}>
                        <input
                          type="checkbox"
                          checked={signupCgv}
                          onChange={e=>setSignupCgv(e.target.checked)}
                          style={{width:18,height:18,accentColor:"var(--cyan)",marginTop:1,flexShrink:0,cursor:"pointer"}}
                        />
                        <label style={{fontSize:13,color:"var(--text-secondary)",lineHeight:1.5,cursor:"pointer"}}>
                          J'ai lu et j'accepte les{" "}
                          <a href="#" style={{color:"var(--cyan)",textDecoration:"none"}}>Conditions Générales</a> et la{" "}
                          <a href="#" style={{color:"var(--cyan)",textDecoration:"none"}}>Politique de confidentialité</a> de LabelEnergie.
                        </label>
                      </div>

                      <SubmitButton loading={signupLoading} onClick={handleSignup} label="Créer mon compte" loadingLabel="Création du compte…"/>

                      {signupError && (
                        <div style={{marginTop:12,fontSize:13,color:"#E24B4A",lineHeight:1.4}}>
                          {signupError}
                        </div>
                      )}

                      {signupProfileLocked && (
                        <div style={{textAlign:"center",fontSize:13,color:"var(--text-muted)",marginTop:16}}>
                          Ces informations ont été préremplies.{" "}
                          <a
                            onClick={()=>{
                              setSignupProfileLocked(false);
                              setSignupStep("email");
                              setSignupPrefillError(null);
                              setSignupError(null);
                              setSignupPass("");
                              setSignupCgv(false);
                            }}
                            style={{color:"var(--cyan)",textDecoration:"none",fontWeight:500,cursor:"pointer"}}
                          >
                            Utiliser un autre email
                          </a>
                        </div>
                      )}

                      <div style={{textAlign:"center",fontSize:13,color:"var(--text-muted)",marginTop:20}}>
                        Déjà un compte ?{" "}
                        <a onClick={()=>setTab("login")} style={{color:"var(--cyan)",textDecoration:"none",fontWeight:500,cursor:"pointer"}}>
                          Se connecter
                        </a>
                      </div>

                      <div style={{textAlign:"center",fontSize:12,color:"var(--text-muted)",marginTop:10}}>
                        En créant votre compte, vos informations seront utilisées pour personnaliser votre espace client.
                      </div>
                    </>
                  )}
                </>
              ) : (
                <SuccessScreen title="Compte créé !" sub="Un e-mail de confirmation vous a été envoyé."/>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Form helpers ───────────────────────────────────────────────────────────
function FieldInput({
  label,
  type,
  placeholder,
  value,
  onChange,
  autoComplete,
  disabled
}:{
  label:string;type:string;placeholder:string;value:string;
  onChange:(v:string)=>void;autoComplete?:string;disabled?:boolean;
}){
  const [focused,setFocused]=useState(false);
  return (
    <div style={{marginBottom:16}}>
      <label style={{display:"block",fontSize:13,fontWeight:500,color:"var(--text-secondary)",marginBottom:6}}>{label}</label>
      <input
        type={type} placeholder={placeholder} value={value}
        onChange={e=>onChange(e.target.value)} autoComplete={autoComplete}
        onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
        disabled={disabled}
        style={{
          width:"100%",padding:"12px 16px",borderRadius:10,
          border:`1px solid ${disabled?"var(--border-strong)":(focused?"var(--cyan)":"var(--border-strong)")}`,
          background:disabled?"#f3f4f6":"#fff",
          fontFamily:"'DM Sans',sans-serif",fontSize:15,
          color:"var(--text)",outline:"none",transition:"border-color .2s,box-shadow .2s",
          boxShadow:disabled?"none":focused?"0 0 0 3px rgba(0,184,220,0.12)":"none",
          cursor:disabled?"not-allowed":"text"
        }}
      />
    </div>
  );
}

function PasswordInput({id,placeholder,value,onChange,show,onToggle,autoComplete}:{
  id:string;placeholder:string;value:string;onChange:(v:string)=>void;
  show:boolean;onToggle:()=>void;autoComplete?:string;
}){
  const [focused,setFocused]=useState(false);
  return (
    <div style={{position:"relative"}}>
      <input
        id={id} type={show?"text":"password"} placeholder={placeholder}
        value={value} onChange={e=>onChange(e.target.value)} autoComplete={autoComplete}
        onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
        style={{
          width:"100%",padding:"12px 44px 12px 16px",borderRadius:10,
          border:`1px solid ${focused?"var(--cyan)":"var(--border-strong)"}`,
          background:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:15,
          color:"var(--text)",outline:"none",transition:"border-color .2s,box-shadow .2s",
          boxShadow:focused?"0 0 0 3px rgba(0,184,220,0.12)":"none"
        }}
      />
      <button
        type="button" onClick={onToggle}
        style={{
          position:"absolute",right:14,top:"50%",transform:"translateY(-50%)",
          background:"none",border:"none",cursor:"pointer",color:"var(--text-muted)",
          padding:0,fontSize:16,lineHeight:1,transition:"color .2s",fontFamily:"inherit"
        }}
      >{show?"🙈":"👁"}</button>
    </div>
  );
}

function SubmitButton({loading,onClick,label,loadingLabel}:{
  loading:boolean;onClick:()=>void;label:string;loadingLabel:string;
}){
  return (
    <button
      type="button" onClick={onClick} disabled={loading}
      style={{
        width:"100%",padding:14,borderRadius:50,
        background:"linear-gradient(135deg,var(--cyan),var(--teal))",
        color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:500,
        border:"none",cursor:loading?"not-allowed":"pointer",transition:"all .25s",
        boxShadow:"0 4px 16px rgba(0,184,220,0.25)",opacity:loading?.8:1
      }}
    >{loading?loadingLabel:label}</button>
  );
}

function OrDivider(){
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,margin:"22px 0",fontSize:13,color:"var(--text-muted)"}}>
      <div style={{flex:1,height:1,background:"var(--border)"}}/>
      ou
      <div style={{flex:1,height:1,background:"var(--border)"}}/>
    </div>
  );
}

function SocialButton({ onClick, loading }: { onClick: () => void | Promise<void>; loading?: boolean }) {
  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => {
        if (!loading) void onClick();
      }}
      style={{
        width:"100%",padding:12,borderRadius:10,border:"1px solid var(--border-strong)",
        background:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:14,
        color:"var(--text-secondary)",cursor:loading ? "not-allowed" : "pointer",transition:"all .2s",
        display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10
      }}
    >
      <GoogleIcon/> {loading ? "Connexion…" : "Continuer avec Google"}
    </button>
  );
}

function SuccessScreen({title,sub}:{title:string;sub:string}){
  return (
    <div style={{textAlign:"center",padding:"20px 0 8px",animation:"fadeUp .4s ease"}}>
      <div style={{
        width:64,height:64,borderRadius:"50%",
        background:"linear-gradient(135deg,var(--cyan-10),var(--teal-10))",
        border:"2px solid var(--border-cyan)",display:"flex",alignItems:"center",
        justifyContent:"center",margin:"0 auto 16px",fontSize:28,color:"var(--teal)"
      }}>✓</div>
      <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:18,fontWeight:700,color:"var(--text)",marginBottom:8}}>{title}</div>
      <div style={{fontSize:14,color:"var(--text-muted)"}}>{sub}</div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function LabelEnergie() {
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<AuthTab>("login");
  const [headerUser, setHeaderUser] = useState<FirebaseUser | null>(() => auth.currentUser);

  useEffect(() => {
    // Ensure header renders “connected” immediately after navigation (mobile-safe)
    setHeaderUser(auth.currentUser);
    const unsub = onAuthStateChanged(auth, setHeaderUser);
    return () => unsub();
  }, []);

  // Wizard contrat d'entretien (landing): Standard/Premium/VIP -> produit -> reste du formulaire
  const [contractWizardOpen, setContractWizardOpen] = useState(false);
  const [contractWizardPreset, setContractWizardPreset] = useState<ContractFormula["id"] | null>(null);
  const [contractWizardSubmitting, setContractWizardSubmitting] = useState(false);
  const [contractWizardError, setContractWizardError] = useState<string | null>(null);
  const [pendingContractPayload, setPendingContractPayload] = useState<ContractRequestPayload | null>(null);

  function openContractWizard(preset: ContractFormula["id"]) {
    setContractWizardPreset(preset);
    setContractWizardError(null);
    setPendingContractPayload(null);
    setContractWizardOpen(true);
  }

  function openModal(tab:AuthTab){
    setModalTab(tab);
    setModalOpen(true);
  }

  async function submitContractFromLanding(payload: ContractRequestPayload, user: FirebaseUser) {
    const email = user.email?.trim().toLowerCase() || "";
    if (!email) throw new Error("Email utilisateur introuvable. Veuillez vous reconnecter.");

    setContractWizardSubmitting(true);
    setContractWizardError(null);
    try {
      // 1) clientId depuis client_portal_users
      const portalUserSnap = await getDocTracked(doc(db, "client_portal_users", user.uid), "submitContract:portalUserByUid");
      const portalData = portalUserSnap.exists() ? (portalUserSnap.data() as { clientId?: string }) : null;
      const clientId = portalData?.clientId || null;
      if (!clientId) throw new Error("Compte portail non lié à un client. Veuillez contacter le support.");

      // 2) maintenance : trouver ou créer
      const maintenancesRef = collection(db, "maintenances");
      const maintQueries: Array<ReturnType<typeof getDocs>> = [];
      maintQueries.push(getDocs(query(maintenancesRef, where("clientId", "==", clientId))));
      maintQueries.push(getDocs(query(maintenancesRef, where("clientContact.email", "==", email))));
      maintQueries.push(getDocs(query(maintenancesRef, where("signerEmail", "==", email))));
      const maintSnaps = await Promise.all(maintQueries);
      const first = maintSnaps.flatMap((s) => s.docs)[0];
      let maintenanceId = first?.id ?? null;

      if (!maintenanceId) {
        const equipmentName =
          payload.products.length === 1
            ? payload.products[0].name
            : `${payload.products[0].name} + ${payload.products.length - 1} autre(s)`;

        const created = await createPortalMaintenanceForContract({
          clientId,
          clientName: payload.schedulePayment.gocardless.accountHolder?.trim() || "Client",
          signerEmail: email,
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

      // 3) PDF + upload Storage
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

      const pdfBlob = await downloadContractPdf(pdfData, false);
      const storage = getStorage();
      const fileName = `${payload.contractNumber}.pdf`;
      const filePath = `maintenances/${maintenanceId}/documents/${fileName}`;
      const pdfFileRef = storageRef(storage, filePath);
      await uploadBytes(pdfFileRef, pdfBlob);
      const pdfUrl = await getDownloadURL(pdfFileRef);

      // 4) backend : signature request + Firestore writes
      const fullName = payload.schedulePayment.gocardless.accountHolder.trim();
      const parts = fullName.split(/\\s+/).filter(Boolean);
      const signerFirstName = parts[0] ?? "";
      const signerLastName = parts.slice(1).join(" ");

      await createPortalContractAndSendForSignature({
        maintenanceId: maintenanceId!,
        contractNumber: payload.contractNumber,
        pdfUrl,
        signerEmail: email,
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

      setContractWizardOpen(false);
      navigate("/client-portal");
    } finally {
      setContractWizardSubmitting(false);
    }
  }

  async function handleWizardSubmit(payload: ContractRequestPayload) {
    const user = auth.currentUser;
    if (!user) {
      setPendingContractPayload(payload);
      setModalTab("login");
      setModalOpen(true);
      return;
    }
    try {
      await submitContractFromLanding(payload, user);
    } catch (e) {
      setContractWizardError(e instanceof Error ? e.message : "Erreur lors de la demande de contrat.");
    }
  }

  async function handleAuthedForWizard(user: FirebaseUser) {
    if (!pendingContractPayload) return;
    const payload = pendingContractPayload;
    setPendingContractPayload(null);
    try {
      await submitContractFromLanding(payload, user);
    } catch (e) {
      setContractWizardError(e instanceof Error ? e.message : "Erreur lors de la demande de contrat.");
    }
  }

  return (
    <>
      <GlobalStyles/>

      <SiteHeader
        user={headerUser}
        onOpenLoginModal={() => openModal("login")}
        onSignOut={() => signOut(auth)}
      />

      <HeroSection onPrimaryCta={() => openContractWizard("premium")} />

      <BrandMarqueeSection />

      <EquipementsSection onChoosePremium={() => openContractWizard("premium")} />

      <FormulesSection
        onChooseStandard={() => openContractWizard("standard")}
        onChoosePremium={() => openContractWizard("premium")}
        onChooseVip={() => openContractWizard("vip")}
      />

      {/* AVANTAGES */}
      <section id="avantages" style={{padding:"var(--section-py) var(--container-px)",maxWidth:"var(--container-max)",margin:"0 auto"}}>
        <Reveal>
          <p style={{fontSize:12,fontWeight:600,letterSpacing:".1em",textTransform:"uppercase",color:"var(--cyan)",marginBottom:10}}>Pourquoi LabelEnergie</p>
          <h2 style={{fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(26px,4vw,44px)",fontWeight:700,letterSpacing:"-1px",lineHeight:1.1,color:"var(--text)",marginBottom:14}}>L'entretien professionnel,<br/>un investissement rentable</h2>
          <p style={{fontSize:16,color:"var(--text-secondary)",maxWidth:620,lineHeight:1.7,marginBottom:36}}>Le coût annuel de l'abonnement est généralement inférieur au coût d'une seule intervention hors contrat.</p>
          <button type="button" onClick={()=>openContractWizard("premium")} className="cta-primary-premium" style={{marginTop:4, marginBottom:24}}>Découvrir la formule Premium</button>
        </Reveal>
        <Reveal>
          <div className="section-shell-premium" style={{padding:"26px"}}>
          <div className="why-grid" style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:16}}>
            {[
              {num:"1er",title:"Priorité absolue",desc:"Vous êtes systématiquement traité avant tout client non abonné, quelle que soit la date de leur demande respective."},
              {num:"+10ans",title:"Durée de vie prolongée",desc:"La maintenance préventive annuelle prolonge significativement la durée de vie de vos équipements en détectant les anomalies en amont."},
            ].map(w=>(
              <div key={w.num} className="why-card" style={{background:"#fff",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:32,boxShadow:"var(--shadow-sm)"}}>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:52,fontWeight:800,lineHeight:1,background:"linear-gradient(135deg,var(--cyan),var(--teal))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",marginBottom:8}}>{w.num}</div>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:17,fontWeight:600,color:"var(--text)",marginBottom:8}}>{w.title}</div>
                <div style={{fontSize:14,color:"var(--text-secondary)",lineHeight:1.65}}>{w.desc}</div>
              </div>
            ))}
            {/* Wide card */}
            <div className="why-card why-wide" style={{background:"#fff",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:32,boxShadow:"var(--shadow-sm)",gridColumn:"span 2"}}>
              <div className="why-wide-inner" style={{display:"flex",gap:40,alignItems:"center"}}>
                <div style={{flexShrink:0}}>
                  <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:52,fontWeight:800,lineHeight:1,background:"linear-gradient(135deg,var(--cyan),var(--teal))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",marginBottom:8}}>100%</div>
                  <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:17,fontWeight:600,color:"var(--text)",marginBottom:8}}>Garantie constructeur préservée</div>
                </div>
                <div style={{fontSize:14,color:"var(--text-secondary)",lineHeight:1.65,maxWidth:500}}>Les assureurs et fabricants exigent un entretien annuel attesté. Notre attestation officielle délivrée par un technicien RGE certifié est valable auprès de tous les assureurs habitation et constitue votre protection en cas de sinistre ou litige.</div>
              </div>
            </div>
            {[
              {num:"3 mois",title:"Garantie main-d'œuvre",desc:"Toute intervention réalisée par nos techniciens est couverte par une garantie de 3 mois sur la main-d'œuvre."},
              {num:"RGPD",title:"Données protégées",desc:"Vos données ne sont jamais cédées ni revendues à des tiers. Conservation sécurisée 5 ans après fin du contrat."},
            ].map(w=>(
              <div key={w.num} className="why-card" style={{background:"#fff",border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:32,boxShadow:"var(--shadow-sm)"}}>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:52,fontWeight:800,lineHeight:1,background:"linear-gradient(135deg,var(--cyan),var(--teal))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",marginBottom:8}}>{w.num}</div>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:17,fontWeight:600,color:"var(--text)",marginBottom:8}}>{w.title}</div>
                <div style={{fontSize:14,color:"var(--text-secondary)",lineHeight:1.65}}>{w.desc}</div>
              </div>
            ))}
          </div>
          </div>
        </Reveal>
      </section>

      {/* PROCESSUS */}
      <section id="processus" style={{padding:"var(--section-py) var(--container-px)",background:"var(--bg2)"}}>
        <div style={{maxWidth:"var(--container-max)",margin:"0 auto"}}>
          <Reveal style={{textAlign:"center"}}>
            <p style={{fontSize:12,fontWeight:600,letterSpacing:".1em",textTransform:"uppercase",color:"var(--cyan)",marginBottom:10}}>Votre contrat, simplement</p>
            <h2 style={{fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(26px,4vw,44px)",fontWeight:700,letterSpacing:"-1px",lineHeight:1.1,color:"var(--text)",marginBottom:14}}>Souscription → suivi → intervention</h2>
            <p style={{fontSize:16,color:"var(--text-secondary)",maxWidth:620,lineHeight:1.7,margin:"0 auto 52px"}}>En quelques minutes vous souscrivez, puis vous suivez vos documents et vos interventions dans votre espace client.</p>
          </Reveal>

          <div className="section-shell-premium" style={{padding:"24px"}}>
          <div className="process-grid" style={{display:"grid",gridTemplateColumns:"repeat(5, minmax(0,1fr))",gap:16}}>
            {[
              {k:"ÉTUDE GRATUITE",t:"Évaluation du projet",d:"Premières informations sur l'habitation et cadrage de vos besoins."},
              {k:"VISITE TECHNIQUE",t:"Analyse du logement",d:"Bilan énergétique et recommandations adaptées à votre situation."},
              {k:"ENTRETIEN & MAINTENANCE",t:"Suivi technique",d:"Préparation des interventions et accompagnement sur la maintenance."},
              {k:"MONTAGE DOSSIER",t:"Dossier & démarches",d:"Constitution et pilotage des demandes d'aides selon votre projet."},
              {k:"INSTALLATION",t:"Mise en place",d:"Installation des équipements et remise des documents clés."}
            ].map((s) => (
              <div key={s.t} className="fidelity-step" style={{background:"#fff",border:"1px solid var(--border)",borderRadius:"var(--radius-sm)",padding:"22px 18px",textAlign:"center",boxShadow:"var(--shadow-sm)"}}>
                <div style={{width:42,height:42,margin:"0 auto 12px",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",background:"var(--cyan-10)",border:"1px solid var(--border-cyan)",fontSize:16,fontWeight:800,color:"var(--cyan)"}}>
                  {String(["01","02","03","04","05"][[
                    "Évaluation du projet",
                    "Analyse du logement",
                    "Suivi technique",
                    "Dossier & démarches",
                    "Mise en place",
                  ].indexOf(s.t)] ?? "01")}
                </div>
                <div style={{fontSize:12,fontWeight:600,color:"var(--cyan)",marginBottom:8,letterSpacing:".04em"}}>{s.k}</div>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:18,fontWeight:700,color:"var(--text)",marginBottom:6}}>{s.t}</div>
                <div style={{fontSize:12,color:"var(--text-muted)",lineHeight:1.5}}>{s.d}</div>
              </div>
            ))}
          </div>
          </div>
        </div>
      </section>

      {/* FIDÉLITÉ */}
      <section id="fidelite" style={{padding:"var(--section-py) var(--container-px)",maxWidth:"var(--container-max)",margin:"0 auto"}}>
        <Reveal>
          <p style={{fontSize:12,fontWeight:600,letterSpacing:".1em",textTransform:"uppercase",color:"var(--cyan)",marginBottom:10}}>Programme de fidélité</p>
          <h2 style={{fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(26px,4vw,44px)",fontWeight:700,letterSpacing:"-1px",lineHeight:1.1,color:"var(--text)",marginBottom:14}}>Plus longtemps abonné,<br/>plus vous gagnez</h2>
          <p style={{fontSize:16,color:"var(--text-secondary)",maxWidth:520,lineHeight:1.7,marginBottom:52}}>Avantages progressifs et automatiques — aucune démarche à effectuer.</p>
        </Reveal>
        <Reveal>
          <div className="section-shell-premium" style={{padding:"24px"}}>
          <div className="fidelity-steps-wrap" style={{display:"flex",gap:16}}>
            {[
              {year:"Dès la 2e année",reward:"Priorité+",accent:false,desc:"Accès prioritaire renforcé, tête de file parmi les abonnés",highlight:false},
              {year:"Dès la 3e année",reward:"−5%",accent:false,desc:"Réduction sur la cotisation mensuelle annuelle",highlight:false},
              {year:"Dès la 5e année",reward:"−10%",accent:false,desc:"+ bilan technique complet gratuit chaque année",highlight:false},
              {year:"Dès la 10e année",reward:"−15%",accent:true,desc:"Statut Client Fidèle · devis préférentiel sur travaux",highlight:true},
            ].map(s=>(
              <div key={s.year} className="fidelity-step" style={{flex:1,background:"#fff",border:`1px solid ${s.highlight?"rgba(0,184,220,0.2)":"var(--border)"}`,borderRadius:"var(--radius-sm)",padding:"22px 18px",textAlign:"center",boxShadow:"var(--shadow-sm)"}}>
                <div style={{fontSize:12,fontWeight:600,color:"var(--cyan)",marginBottom:8,letterSpacing:".04em"}}>{s.year}</div>
                <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:28,fontWeight:700,marginBottom:6,
                  ...(s.accent?{background:"linear-gradient(90deg,var(--cyan),var(--teal))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}:{color:"var(--text)"})
                }}>{s.reward}</div>
                <div style={{fontSize:12,color:"var(--text-muted)",lineHeight:1.5}}>{s.desc}</div>
              </div>
            ))}
          </div>
          </div>
        </Reveal>
        <Reveal style={{marginTop:18,padding:"24px 26px",background:"linear-gradient(135deg,rgba(0,184,220,0.06),rgba(0,201,167,0.08))",border:"1px solid rgba(0,184,220,0.16)",borderRadius:"24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:16,boxShadow:"0 18px 44px rgba(13,27,42,0.06)"}}>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:"var(--cyan)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:6}}>Parrainage premium</div>
            <div style={{fontSize:18,fontWeight:700,color:"var(--text)",marginBottom:4}}>Parrainez un proche et gagnez immédiatement</div>
            <div style={{fontSize:13,color:"var(--text-muted)"}}>Vous recevez 1 mois offert · Votre filleul bénéficie du 1er mois à −50%</div>
          </div>
          <button onClick={()=>openContractWizard("premium")} className="cta-primary-premium">Souscrire →</button>
        </Reveal>

        <Reveal style={{marginTop:12,textAlign:"center"}}>
          <button type="button" onClick={()=>openContractWizard("premium")} className="cta-primary-premium">
            Je souscris maintenant
          </button>
          <div style={{marginTop:10,fontSize:13,color:"var(--text-muted)"}}>Vous pourrez upgrader/downgrader ensuite selon vos besoins.</div>
        </Reveal>
      </section>

      

      <TestimonialsSection />

      {/* CERTIFS */}
      <section style={{padding:"var(--section-py) var(--container-px)",maxWidth:"var(--container-max)",margin:"0 auto"}}>
        <Reveal>
          <p style={{fontSize:12,fontWeight:600,letterSpacing:".1em",textTransform:"uppercase",color:"var(--cyan)",marginBottom:10}}>Certifications &amp; assurances</p>
          <h2 style={{fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(26px,4vw,44px)",fontWeight:700,letterSpacing:"-1px",lineHeight:1.1,color:"var(--text)",marginBottom:14}}>Nos certifications vous protègent.</h2>
          <p style={{fontSize:16,color:"var(--text-secondary)",maxWidth:520,lineHeight:1.7,marginBottom:52}}>Interventions réalisées par des techniciens habilités dans le respect de la réglementation en vigueur.</p>
        </Reveal>
        <Reveal>
          <div className="section-shell-premium" style={{padding:"22px"}}>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {["RGE — Reconnu Garant de l'Environnement","QualiPac — Pompes à chaleur","QualiSol — Solaire thermique","RC Professionnelle","Responsabilité Décennale","Attestation CERFA fluides frigorigènes"].map(cert=>(
              <div key={cert} className="cert-pill" style={{display:"flex",alignItems:"center",gap:8,padding:"12px 18px",borderRadius:50,background:"#fff",border:"1px solid var(--border)",fontSize:13,color:"var(--text-secondary)",boxShadow:"var(--shadow-sm)"}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:"var(--teal)",flexShrink:0}}/>
                {cert}
              </div>
            ))}
          </div>
          </div>
        </Reveal>

        <Reveal style={{ marginTop: 14 }}>
          <div className="trust-wall">
            <div className="trust-grid">
              <div className="trust-block">
                <div className="trust-head">
                  <div className="trust-kicker">Qualifications RGE</div>
                  <div className="trust-sub">Référentiels officiels · interventions conformes</div>
                </div>
                <div className="logo-grid">
                  {[
                    { src: "/MARQUES/QUALIFICATIONS%20RGE/RGE.png", alt: "RGE" },
                    { src: "/MARQUES/QUALIFICATIONS%20RGE/QUALIBOIS.png", alt: "QualiBois" },
                    { src: "/MARQUES/QUALIFICATIONS%20RGE/QUALIPAC.png", alt: "QualiPac" },
                    { src: "/MARQUES/QUALIFICATIONS%20RGE/QUALIPV.png", alt: "QualiPV", scale: 1.18 },
                  ].map((q) => (
                    <div key={q.src} className="logo-tile">
                      <img
                        src={q.src}
                        alt={q.alt}
                        style={q.scale ? { transform: `scale(${q.scale})` } : undefined}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="trust-block">
                <div className="trust-head">
                  <div className="trust-kicker">Partenaires</div>
                  <div className="trust-sub">Financement · dispositifs d’économies d’énergie</div>
                </div>
                <div className="logo-grid partners">
                  {[
                    { src: "/MARQUES/PEE_EDF_LogoPourFondClair_RVB.png", alt: "Partenaire Économies d'Énergie EDF" },
                    { src: "/MARQUES/logo_domofinance.webp", alt: "Domofinance" },
                  ].map((p) => (
                    <div key={p.src} className="logo-tile">
                      <img src={p.src} alt={p.alt} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* CTA BANNER */}
      <section id="contact" style={{padding:"var(--section-py) var(--container-px)",maxWidth:"var(--container-max)",margin:"0 auto"}}>
        <Reveal>
          <div className="cta-banner-inner" style={{background:"linear-gradient(135deg,rgba(0,184,220,0.08),rgba(0,201,167,0.10))",border:"1px solid rgba(0,184,220,0.2)",borderRadius:"32px",padding:"72px 64px",textAlign:"center",boxShadow:"0 26px 64px rgba(13,27,42,0.10)",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:-120,right:-80,width:280,height:280,borderRadius:"50%",background:"radial-gradient(circle, rgba(255,255,255,0.55), transparent 70%)"}} />
            <h2 style={{fontFamily:"'DM Sans',sans-serif",fontSize:"clamp(26px,4vw,46px)",fontWeight:700,letterSpacing:"-1px",marginBottom:14}}>Protégez vos équipements<br/>dès aujourd'hui</h2>
            <p style={{fontSize:16,color:"var(--text-secondary)",marginBottom:32}}>Couvert dès validation · Documents immédiats · Support 7j/7 · 14 jours de rétractation</p>
            <div className="cta-actions-wrap" style={{display:"flex",gap:12,justifyContent:"center"}}>
              <button onClick={()=>openContractWizard("premium")} className="cta-primary-premium">Souscrire au contrat</button>
              <a href="tel:0181723959" className="cta-secondary-premium">Appeler le 01 81 72 39 59</a>
            </div>
          </div>
        </Reveal>
      </section>

      {/* FOOTER */}
      <footer style={{borderTop:"1px solid var(--border)",padding:"40px 48px",display:"flex",justifyContent:"space-between",alignItems:"center",maxWidth:1200,margin:"0 auto"}}>
        <img
          src={logoUrl}
          alt="LabelEnergie"
          style={{ height: 32, width: "auto", display: "block" }}
        />
        <ul style={{display:"flex",gap:24,listStyle:"none"}}>
          {[
            { label: "CGV", href: "/CGV_LabelEnergie_v2%20(1).pdf", target: "_blank" },
            { label: "RGPD", href: "#" },
            { label: "Mentions légales", href: "#" },
            { label: "Rétractation", href: "#" },
            { label: "Médiation", href: "#" },
          ].map((link) => (
            <li key={link.label}>
              <a
                href={link.href}
                target={link.target}
                rel={link.target === "_blank" ? "noreferrer" : undefined}
                style={{fontSize:13,color:"var(--text-muted)",textDecoration:"none",transition:"color .2s"}}
                onMouseEnter={e=>(e.currentTarget.style.color="var(--text-secondary)")}
                onMouseLeave={e=>(e.currentTarget.style.color="var(--text-muted)")}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div style={{fontSize:13,color:"var(--text-muted)"}}>© 2026 LabelEnergie</div>
      </footer>

      {/* MODAL */}
      <AuthModal
        isOpen={modalOpen}
        initialTab={modalTab}
        onClose={()=>setModalOpen(false)}
        onAuthed={handleAuthedForWizard}
        redirectToPortal={!contractWizardOpen}
      />

      <CreateContractModal
        isOpen={contractWizardOpen}
        onClose={() => setContractWizardOpen(false)}
        submitting={contractWizardSubmitting}
        submitError={contractWizardError}
        presetFormulaId={contractWizardPreset ?? undefined}
        onRequireAuth={() => {
          setModalTab("login");
          setModalOpen(true);
        }}
        onSubmit={handleWizardSubmit}
      />

      <PublicChatbotWidget />
    </>
  );
}
