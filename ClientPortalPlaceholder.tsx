import * as React from 'react';

export function ClientPortalPlaceholder() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-gray-900">Espace client</h1>
        <p className="mt-3 text-gray-600">
          Portail client en cours de construction. La page d’accueil marketing est déjà disponible via{' '}
          <code className="px-1 py-0.5 rounded bg-gray-200">Entretien-Project/labelenergie_v2.html</code>.
        </p>
      </div>
    </div>
  );
}

