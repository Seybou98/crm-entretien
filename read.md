## Portail client LabelEnergie (état actuel)

### Ce qui a été réellement réalisé

1. **Landing + modal d’auth intégrées dans `entretien.tsx`**
   - La page marketing + la modale Connexion/Souscription sont désormais gérées entièrement en React.
   - La connexion utilise Firebase :
     - email + mot de passe (`signInWithEmailAndPassword`, `createUserWithEmailAndPassword`)
     - Google OAuth (`signInWithPopup` + `GoogleAuthProvider`)
   - Au login/signup, on crée/maintient le mapping entre Firebase Auth et le CRM via Firestore :
     - collection `client_portal_users` (clé = `authUser.uid`, champ `clientId`)
     - recherche dans `clients` par email (et création minimale si nécessaire)
   - Après succès, redirection vers `"/client-portal"`.

2. **Page privée `/client-portal` (gating auth + chargement CRM)**
   - Route configurée dans `src/App.tsx`.
   - `src/pages/ClientPortalPrivate.tsx` :
     - utilise `onAuthStateChanged(auth, ...)` pour savoir si l’utilisateur est connecté
     - si non connecté : affiche `entretien.tsx` (donc la modale auth React)
     - si connecté : récupère `clientId` dans `client_portal_users`, puis charge le client dans `clients`
     - affiche une première UI de portail + bouton `Déconnexion`

3. **Nettoyage UI (logo)**
   - Remplacement du texte du header et du footer par `Logo_Label.png` dans `entretien.tsx`.

4. **Setup Vite/React pour démarrer en local**
   - Ajout des scripts et fichiers nécessaires (`vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`, `tsconfig.json`).
   - Ajout de `lib/firebase.ts` (initialisation Firebase + exports `auth` et `db`).

### Ce qui reste à faire

1. **Compléter le “vrai” portail**
   - Dashboard (statut maintenance / prochaines dates)
   - Contrats (liste + PDF)
   - Interventions (historique)
   - Documents (liste + téléchargement + upload selon autorisations)
   - Profil client (édition : tel, adresse, prénom/nom)
   - Paiements (statut uniquement)

2. **Sécurité Firestore + Storage (point critique)**
   - Mettre des règles strictes pour que chaque client ne puisse lire/écrire que ses propres données :
     - logique basée sur `client_portal_users -> clientId`
   - Sécuriser aussi l’accès aux fichiers (Storage) par client.

3. **Validation du modèle de données**
   - Confirmer que `clients.contact.email` est unique et stable (sinon définir une stratégie d’identifiant CRM).

4. **Nettoyage de code optionnel (propreté)**
   - Les anciens fichiers “landing/html + auth window.__portalAuth” peuvent être supprimés si non utilisés (ex : `LabelEnergiePortalLanding.tsx`, `labelenergie_v2.html`, `labelenergie_v2_auth.ts`, `labelenergie_auth.ts`) une fois que tu confirms que tout marche via `entretien.tsx` + `ClientPortalPrivate`.
