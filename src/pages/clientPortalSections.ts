export const CLIENT_PORTAL_SECTIONS = [
  { id: "informations", label: "Informations", soon: false },
  { id: "maintenance", label: "Dashboard maintenance", soon: true },
  { id: "contrats", label: "Contrats & documents", soon: true },
  { id: "interventions", label: "Interventions & historique", soon: true },
  { id: "paiements", label: "Paiements", soon: true },
  { id: "faq", label: "FAQ & aide", soon: false },
] as const;

export type ClientPortalSectionId = (typeof CLIENT_PORTAL_SECTIONS)[number]["id"];

export function getClientPortalSectionCopy(sectionId: ClientPortalSectionId): { title: string; description: string } {
  switch (sectionId) {
    case "informations":
      return {
        title: "Votre profil",
        description: "Retrouvez et vérifiez vos informations de contact.",
      };
    case "maintenance":
      return {
        title: "Dashboard maintenance",
        description: "Suivez votre contrat, la signature et vos documents associés.",
      };
    case "contrats":
      return {
        title: "Contrats & documents",
        description: "Téléchargez vos contrats et documents (PDF) liés à vos maintenances.",
      };
    case "interventions":
      return {
        title: "Interventions & historique",
        description: "Consultez vos interventions passées/à venir et l’historique de votre dossier.",
      };
    case "paiements":
      return {
        title: "Paiements",
        description: "Suivez vos prélèvements et l’historique de vos paiements.",
      };
    case "faq":
      return {
        title: "FAQ & aide",
        description: "Posez vos questions sur votre contrat, vos documents et les réponses issues des CGV et de la FAQ.",
      };
  }
}
