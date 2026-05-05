import type { DocumentReference, DocumentSnapshot, Query, QuerySnapshot } from "firebase/firestore";
import { getDoc as firebaseGetDoc, getDocs as firebaseGetDocs } from "firebase/firestore";

type ReadsMetric = {
  totalReads: number;
  byTag: Record<string, number>;
};

declare global {
  interface Window {
    __firestoreReads?: ReadsMetric;
    __firestoreReadsEnabled?: boolean;
  }
}

function enabled() {
  // Activé par défaut en dev; désactivable via window.__firestoreReadsEnabled = false
  if (typeof window === "undefined") return false;
  if (typeof window.__firestoreReadsEnabled === "boolean") return window.__firestoreReadsEnabled;
  return import.meta.env.DEV;
}

function getStore(): ReadsMetric {
  if (typeof window === "undefined") return { totalReads: 0, byTag: {} };
  window.__firestoreReads ??= { totalReads: 0, byTag: {} };
  return window.__firestoreReads;
}

function addReads(tag: string, reads: number) {
  if (!enabled()) return;
  const store = getStore();
  store.totalReads += reads;
  store.byTag[tag] = (store.byTag[tag] ?? 0) + reads;
}

/**
 * getDoc instrumenté.
 * Facturation Firestore: 1 read par document retourné (même si le doc n'existe pas).
 */
export async function getDocTracked<T>(
  ref: DocumentReference<T>,
  tag = "getDoc"
): Promise<DocumentSnapshot<T>> {
  const snap = await firebaseGetDoc(ref);
  addReads(tag, 1);
  return snap;
}

/**
 * getDocs instrumenté.
 * Facturation Firestore: 1 read par document retourné (snap.size).
 */
export async function getDocsTracked<T>(
  q: Query<T>,
  tag = "getDocs"
): Promise<QuerySnapshot<T>> {
  const snap = await firebaseGetDocs(q);
  addReads(tag, snap.size);
  return snap;
}

export function resetFirestoreReads() {
  if (typeof window === "undefined") return;
  window.__firestoreReads = { totalReads: 0, byTag: {} };
}

