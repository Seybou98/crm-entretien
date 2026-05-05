import { describe, expect, it } from "vitest";

import type { KnowledgeChunk } from "../types";
import { answerPublicQuestion } from "./publicChatbot";

const chunks: KnowledgeChunk[] = [
  {
    id: "cgv-premium-delay",
    sourceId: "cgv",
    sourceTitle: "CGV",
    sectionTitle: "Delais d'intervention",
    content:
      "La formule Premium prevoit un delai d'intervention sous 5 jours ouvres avec priorite renforcee.",
    keywords: ["premium", "delai", "intervention", "5 jours ouvres", "priorite"],
  },
  {
    id: "faq-resiliation",
    sourceId: "faq",
    sourceTitle: "FAQ",
    sectionTitle: "Resiliation",
    content:
      "Le client peut resilier son contrat selon les conditions prevues dans les CGV et avant l'echeance annuelle.",
    keywords: ["resiliation", "contrat", "echeance"],
  },
  {
    id: "faq-vip",
    sourceId: "faq",
    sourceTitle: "FAQ",
    sectionTitle: "Formule VIP",
    content:
      "La formule VIP comprend des depannages illimites en usage normal, 30 pour cent de remise sur les pieces et la main d oeuvre de depannage incluse.",
    keywords: ["vip", "depannages illimites", "pieces", "main d oeuvre"],
  },
  {
    id: "faq-payment",
    sourceId: "faq",
    sourceTitle: "FAQ",
    sectionTitle: "Paiement",
    content:
      "Le paiement peut etre realise au comptant ou par prelevement automatique mensuel.",
    keywords: ["paiement", "prelevement automatique", "comptant", "mensuel"],
  },
];

describe("answerPublicQuestion", () => {
  it("returns the best scripted answer with source metadata", () => {
    const result = answerPublicQuestion("Quel est le delai d'intervention pour Premium ?", chunks);

    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") {
      throw new Error("Expected an answer result");
    }

    expect(result.answer).toContain("5 jours ouvres");
    expect(result.answer).toContain("Premium");
    expect(result.sourceTitle).toBe("CGV");
    expect(result.suggestedQuestions.length).toBeGreaterThan(0);
  });

  it("returns a safe fallback when no reliable answer is found", () => {
    const result = answerPublicQuestion("Est-ce que vous intervenez le dimanche a minuit ?", chunks);

    expect(result.kind).toBe("fallback");
    if (result.kind !== "fallback") {
      throw new Error("Expected a fallback result");
    }

    expect(result.answer).toContain("Je n'ai pas trouve");
  });

  it("matches coverage questions for VIP with specific benefits", () => {
    const result = answerPublicQuestion("Que couvre la formule VIP ?", chunks);

    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") {
      throw new Error("Expected an answer result");
    }

    expect(result.answer).toContain("depannages illimites");
    expect(result.answer).toContain("main d oeuvre");
  });

  it("matches payment questions with the payment section", () => {
    const result = answerPublicQuestion("Quels sont les moyens de paiement ?", chunks);

    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") {
      throw new Error("Expected an answer result");
    }

    expect(result.answer).toContain("prelevement automatique");
    expect(result.answer).toContain("comptant");
  });

  it("understands synonym-style wording for contract cancellation", () => {
    const result = answerPublicQuestion("Je veux arreter mon contrat, comment faire ?", chunks);

    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") {
      throw new Error("Expected an answer result");
    }

    expect(result.answer).toContain("resili");
  });
});
