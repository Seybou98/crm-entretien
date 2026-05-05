import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "demo-auth-domain",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "demo-project-id",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "demo-storage-bucket",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "demo-sender-id",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "demo-app-id"
};

// Initialise Firebase even with demo values so the app can start in dev.
// Real credentials should be provided via `VITE_FIREBASE_*` env vars.
const app: FirebaseApp = initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);

