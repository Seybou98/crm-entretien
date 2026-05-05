import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { User as FirebaseUser } from "firebase/auth";
import logoUrl from "../../Logo_Label.png";
import {
  CLIENT_PORTAL_SECTIONS,
  type ClientPortalSectionId,
} from "../pages/clientPortalSections";

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

export type SiteHeaderProps = {
  user: FirebaseUser | null;
  /** Nom affiché (ex. CRM) ; sinon displayName / email */
  profileDisplayName?: string;
  onOpenLoginModal: () => void;
  onSignOut: () => void | Promise<void>;
};

const NAV_LINKS: [string, string][] = [
  ["equipements", "Nos solutions"],
  ["processus", "Processus"],
  ["avantages", "Pourquoi LabelEnergie"]
];

export function SiteHeader({ user, profileDisplayName, onOpenLoginModal, onSignOut }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const onPortal = location.pathname.startsWith("/client-portal");

  const displayName =
    profileDisplayName?.trim() ||
    user?.displayName?.trim() ||
    (user?.email ? user.email.split("@")[0] : "") ||
    "Mon compte";
  const emailLine = user?.email ?? "";
  function clientPortalSectionUrl(sectionId: ClientPortalSectionId) {
    return `/client-portal?section=${encodeURIComponent(sectionId)}`;
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  function scrollToSection(hash: string) {
    const target = document.getElementById(hash);
    if (!target) return false;

    const headerHeight = 76;
    const top = target.getBoundingClientRect().top + window.scrollY - headerHeight;
    window.scrollTo({ top, behavior: "smooth" });
    return true;
  }

  useEffect(() => {
    if (location.pathname !== "/") return;
    if (!location.hash) return;

    const hash = location.hash.replace(/^#/, "");
    const raf = window.requestAnimationFrame(() => {
      scrollToSection(hash);
    });

    return () => window.cancelAnimationFrame(raf);
  }, [location.pathname, location.hash]);

  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        padding: "0 var(--container-px)",
        height: "var(--header-h)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(20px)",
        borderBottom: "0.5px solid var(--border)"
      }}
    >
      <Link to="/" style={{ display: "flex", alignItems: "center", lineHeight: 0 }}>
        <img src={logoUrl} alt="LabelEnergie" style={{ height: 32, width: "auto", display: "block" }} />
      </Link>
      <ul className="nav-links-ul" style={{ display: "flex", alignItems: "center", gap: 36, listStyle: "none" }}>
        {NAV_LINKS.map(([hash, label]) => (
          <li key={hash}>
            <Link
              to={`/#${hash}`}
              onClick={(e) => {
                e.preventDefault();
                if (location.pathname === "/") {
                  const ok = scrollToSection(hash);
                  if (ok) {
                    window.history.replaceState(null, "", `/#${hash}`);
                    return;
                  }
                }
                navigate(`/#${hash}`);
              }}
              style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                textDecoration: "none",
                transition: "color .2s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <a
          className="header-call"
          href="tel:+33181723959"
          aria-label="Appeler LabelEnergie au 01 81 72 39 59"
          title="Appeler le 01 81 72 39 59"
        >
          <span className="header-call__icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M9.5 4.5 8.25 3.25c-.6-.6-1.57-.6-2.17 0L4.6 4.73c-.61.61-.74 1.55-.32 2.3 2.07 3.75 5.0 6.68 8.75 8.75.75.42 1.69.29 2.3-.32l1.48-1.48c.6-.6.6-1.57 0-2.17L15.5 9.5c-.5-.5-1.26-.6-1.87-.23l-1.05.64a11.9 11.9 0 0 1-3.49-3.49l.64-1.05c.37-.61.27-1.37-.23-1.87Z"
                fill="currentColor"
              />
            </svg>
          </span>
          <span className="header-call__text">
            01 81 72 39 59
           
          </span>
        </a>

        {!user ? (
          <button
            type="button"
            onClick={onOpenLoginModal}
            aria-label="Espace client — connexion"
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              background: "var(--cyan)",
              border: "none",
              cursor: "pointer",
              transition: "all .2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 16px rgba(0,184,220,0.25)"
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 12c2.761 0 5-2.239 5-5S14.761 2 12 2 7 4.239 7 7s2.239 5 5 5Z"
                fill="white"
              />
              <path
                d="M4 22c0-4.418 3.582-8 8-8s8 3.582 8 8"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : (
          <div ref={wrapRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              aria-label="Menu profil"
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                background: "linear-gradient(135deg,var(--cyan),var(--teal))",
                border: "2px solid var(--border-cyan)",
                cursor: "pointer",
                transition: "all .2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 16px rgba(0,184,220,0.2)",
                fontFamily: "'DM Sans',sans-serif",
                fontSize: 13,
                fontWeight: 700,
                color: "#fff"
              }}
            >
              {labelInitials(displayName)}
            </button>
            {menuOpen ? (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 10px)",
                  minWidth: 260,
                  padding: 16,
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  boxShadow: "var(--shadow-md)",
                  textAlign: "left"
                }}
              >
                <div
                  style={{
                    fontFamily: "'DM Sans',sans-serif",
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--text)",
                    marginBottom: 4,
                    lineHeight: 1.25
                  }}
                >
                  {displayName}
                </div>
                {emailLine ? (
                  <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>Email: {emailLine}</div>
                ) : null}

                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                      marginBottom: 8,
                    }}
                  >
                    Mon espace
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {CLIENT_PORTAL_SECTIONS.map((s) => (
                      <Link
                        key={s.id}
                        to={clientPortalSectionUrl(s.id)}
                        onClick={() => setMenuOpen(false)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "9px 10px",
                          borderRadius: "var(--radius-sm)",
                          textDecoration: "none",
                          fontSize: 13,
                          color: "var(--text)",
                          background: "rgba(0,184,220,0.06)",
                          border: "1px solid rgba(0,184,220,0.18)",
                        }}
                      >
                        <span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {s.label}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    setMenuOpen(false);
                    await onSignOut();
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 999,
                    background: "var(--cyan-10)",
                    color: "var(--cyan)",
                    border: "1px solid var(--border-cyan)",
                    cursor: "pointer",
                    fontFamily: "'DM Sans',sans-serif",
                    fontSize: 14,
                    fontWeight: 500
                  }}
                >
                  Déconnexion
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </nav>
  );
}
