import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import EntretienPage from "../entretien";
import { ClientPortalPrivate } from "./pages/ClientPortalPrivate";

export function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<EntretienPage />} />
        <Route path="/client-portal" element={<ClientPortalPrivate />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

