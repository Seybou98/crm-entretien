import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  type User
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';

declare global {
  interface Window {
    __portalAuth?: {
      init: () => void;
      handleLogin: () => Promise<void>;
      handleSignup: () => Promise<void>;
      handleGoogleLogin: () => Promise<void>;
    };
    shake?: () => void;
  }
}

const PORTAL_USERS_COL = 'client_portal_users';
const CRM_CLIENTS_COL = 'clients';

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

function getEl<T extends HTMLElement>(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function setReadOnlyInputs(readOnly: boolean) {
  const ids = [
    'signup-prenom',
    'signup-nom',
    'signup-tel',
    'signup-street',
    'signup-postalCode',
    'signup-city',
    'signup-country'
  ];

  for (const id of ids) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) continue;
    input.readOnly = readOnly;
  }
}

function setSignupFieldsFromClient(client: CRMClient) {
  const firstName = client.contact?.firstName ?? '';
  const lastName = client.contact?.lastName ?? '';
  const phone = client.contact?.phone ?? '';

  const street = client.address?.street ?? '';
  const postalCode = client.address?.postalCode ?? '';
  const city = client.address?.city ?? '';
  const country = client.address?.country ?? 'France';

  (getEl<HTMLInputElement>('signup-prenom').value = firstName);
  (getEl<HTMLInputElement>('signup-nom').value = lastName);
  (getEl<HTMLInputElement>('signup-tel').value = phone);

  (getEl<HTMLInputElement>('signup-street').value = street);
  (getEl<HTMLInputElement>('signup-postalCode').value = postalCode);
  (getEl<HTMLInputElement>('signup-city').value = city);
  (getEl<HTMLInputElement>('signup-country').value = country);
}

function clearSignupFields() {
  const ids = [
    'signup-prenom',
    'signup-nom',
    'signup-tel',
    'signup-street',
    'signup-postalCode',
    'signup-city'
  ];
  for (const id of ids) {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (!input) continue;
    input.value = '';
  }
  const country = document.getElementById('signup-country') as HTMLInputElement | null;
  if (country) country.value = 'France';
}

async function findClientByEmail(email: string): Promise<{ clientId: string; client: CRMClient } | null> {
  const clientsRef = collection(db, CRM_CLIENTS_COL);
  const q = query(clientsRef, where('contact.email', '==', email));
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const docSnap = snap.docs[0];
  return { clientId: docSnap.id, client: docSnap.data() as CRMClient };
}

async function createMinimalCRMClient(payload: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  country: string;
}): Promise<string> {
  const now = new Date();
  const fullName = `${payload.firstName} ${payload.lastName}`.trim();

  const clientData = {
    name: fullName || 'Client',
    contact: {
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      phone: payload.phone
    },
    address: {
      street: payload.street,
      postalCode: payload.postalCode,
      city: payload.city,
      country: payload.country
    },
    regie: undefined,
    status: 'entretien',
    createdAt: now,
    updatedAt: now,
    productsIds: [],
    installation: {
      totalTime: 0,
      durationInHours: 0,
      durationInDays: 0,
      durationText: '0h'
    },
    RAC: {
      hasToCollect: false,
      amount: 0
    },
    comment: '',
    tag: null,
    team: null,
    searchIndex: [payload.firstName, payload.lastName, payload.email, payload.phone, fullName].filter(Boolean)
  };

  const clientRef = await addDoc(collection(db, CRM_CLIENTS_COL), clientData);
  await setDoc(doc(db, CRM_CLIENTS_COL, clientRef.id), { id: clientRef.id }, { merge: true });
  return clientRef.id;
}

async function upsertPortalUser(authUser: User, email: string, clientId: string) {
  const portalUserRef = doc(db, PORTAL_USERS_COL, authUser.uid);
  await setDoc(
    portalUserRef,
    {
      authUid: authUser.uid,
      email,
      clientId,
      createdAt: new Date().toISOString()
    },
    { merge: true }
  );
}

async function ensurePortalUserForAuthUser(authUser: User): Promise<string> {
  const email = authUser.email;
  if (!email) throw new Error('Email utilisateur non disponible.');

  const existing = await getDoc(doc(db, PORTAL_USERS_COL, authUser.uid));
  if (existing.exists()) {
    const data = existing.data() as { clientId?: string };
    if (data.clientId) return data.clientId;
  }

  const found = await findClientByEmail(email);
  if (!found) {
    throw new Error('Aucun client CRM trouvé pour cet email. Veuillez créer un compte client.');
  }

  await upsertPortalUser(authUser, email, found.clientId);
  return found.clientId;
}

function showSuccess(panel: 'login' | 'signup') {
  const successId = panel === 'login' ? 'login-success' : 'signup-success';
  const successEl = document.getElementById(successId);
  if (!successEl) return;

  successEl.classList.add('show');

  const panelEl = document.getElementById(`panel-${panel}`);
  if (!panelEl) return;

  const hideSelectors = [
    ' .auth-submit',
    ' .auth-or',
    ' .social-btn',
    ' .auth-switch',
    panel === 'signup' ? ' .field-check' : ' .forgot-link'
  ];

  for (const sel of hideSelectors) {
    panelEl.querySelectorAll(sel).forEach((node) => {
      (node as HTMLElement).style.display = 'none';
    });
  }
}

function getSignupFormValue() {
  const prenom = (getEl<HTMLInputElement>('signup-prenom').value || '').trim();
  const nom = (getEl<HTMLInputElement>('signup-nom').value || '').trim();
  const email = (getEl<HTMLInputElement>('signup-email').value || '').trim();
  const phone = (getEl<HTMLInputElement>('signup-tel').value || '').trim();
  const street = (getEl<HTMLInputElement>('signup-street').value || '').trim();
  const postalCode = (getEl<HTMLInputElement>('signup-postalCode').value || '').trim();
  const city = (getEl<HTMLInputElement>('signup-city').value || '').trim();
  const country = (getEl<HTMLInputElement>('signup-country').value || '').trim() || 'France';
  const password = (getEl<HTMLInputElement>('signup-pass').value || '').trim();
  const cgvChecked = (getEl<HTMLInputElement>('signup-cgv') as HTMLInputElement).checked;

  return { prenom, nom, email, phone, street, postalCode, city, country, password, cgvChecked };
}

function getLoginFormValue() {
  const email = (getEl<HTMLInputElement>('login-email').value || '').trim();
  const password = (getEl<HTMLInputElement>('login-pass').value || '').trim();
  return { email, password };
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function handleLogin() {
  const { email, password } = getLoginFormValue();
  if (!email || !password) {
    window.shake?.();
    return;
  }

  const submit = document.querySelector('#panel-login .auth-submit') as HTMLButtonElement | null;
  if (submit) {
    submit.textContent = 'Connexion…';
    submit.disabled = true;
  }

  try {
    const userCredentialUser = await signInWithEmailAndPassword(auth, email, password);
    const authUser = userCredentialUser.user;

    await ensurePortalUserForAuthUser(authUser);
    showSuccess('login');
    window.location.href = '/client-portal';
  } catch (err) {
    console.error('[portal] login error:', err);
    window.alert(err instanceof Error ? err.message : 'Erreur de connexion');
    window.shake?.();
  } finally {
    if (submit) {
      submit.textContent = 'Se connecter';
      submit.disabled = false;
    }
  }
}

async function handleSignup() {
  const form = getSignupFormValue();
  if (!form.prenom || !form.nom || !form.email || !form.password || !form.cgvChecked) {
    window.shake?.();
    return;
  }
  if (!isValidEmail(form.email)) {
    window.alert('Adresse email invalide');
    window.shake?.();
    return;
  }
  if (form.password.length < 8) {
    window.alert('Mot de passe trop court (min 8 caractères).');
    window.shake?.();
    return;
  }
  if (!form.phone || !form.street || !form.postalCode || !form.city) {
    window.alert('Veuillez compléter téléphone et adresse.');
    window.shake?.();
    return;
  }

  const submit = document.querySelector('#panel-signup .auth-submit') as HTMLButtonElement | null;
  if (submit) {
    submit.textContent = 'Création du compte…';
    submit.disabled = true;
  }

  try {
    const userCredentialUser = await createUserWithEmailAndPassword(auth, form.email, form.password);
    const authUser = userCredentialUser.user;

    const found = await findClientByEmail(form.email);
    const clientId =
      found?.clientId ??
      (await createMinimalCRMClient({
        firstName: form.prenom,
        lastName: form.nom,
        email: form.email,
        phone: form.phone,
        street: form.street,
        postalCode: form.postalCode,
        city: form.city,
        country: form.country
      }));

    await upsertPortalUser(authUser, form.email, clientId);
    showSuccess('signup');
    window.location.href = '/client-portal';
  } catch (err) {
    console.error('[portal] signup error:', err);
    window.alert(err instanceof Error ? err.message : 'Erreur lors de la création du compte');
    window.shake?.();
  } finally {
    if (submit) {
      submit.textContent = 'Créer mon compte';
      submit.disabled = false;
    }
  }
}

async function handleGoogleLogin() {
  const submit = document.querySelector('#panel-login .auth-submit') as HTMLButtonElement | null;
  try {
    if (submit) submit.disabled = true;

    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const authUser = result.user;

    await ensurePortalUserForAuthUser(authUser);
    showSuccess('login');
    window.location.href = '/client-portal';
  } catch (err) {
    console.error('[portal] google login error:', err);
    window.alert(err instanceof Error ? err.message : 'Erreur Google OAuth');
    window.shake?.();
  } finally {
    if (submit) submit.disabled = false;
  }
}

function initPrefill() {
  const emailInput = document.getElementById('signup-email') as HTMLInputElement | null;
  if (!emailInput) return;

  let timer: number | undefined;
  let inFlight = 0;

  emailInput.addEventListener('input', () => {
    const current = ++inFlight;
    if (timer) window.clearTimeout(timer);

    timer = window.setTimeout(async () => {
      if (current !== inFlight) return;

      const email = (emailInput.value || '').trim().toLowerCase();
      if (!email || !isValidEmail(email)) {
        setReadOnlyInputs(false);
        clearSignupFields();
        return;
      }

      try {
        const found = await findClientByEmail(email);
        if (!found) {
          setReadOnlyInputs(false);
          clearSignupFields();
          return;
        }

        setSignupFieldsFromClient(found.client);
        setReadOnlyInputs(true);
      } catch (err) {
        console.error('[portal] prefill error:', err);
      }
    }, 400);
  });
}

function init() {
  initPrefill();
}

window.__portalAuth = {
  init,
  handleLogin,
  handleSignup,
  handleGoogleLogin
};

init();

