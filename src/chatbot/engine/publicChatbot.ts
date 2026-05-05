import type { ChatbotAnswerResult, KnowledgeChunk } from "../types";

const FALLBACK_ANSWER =
  "Je n'ai pas trouve de reponse fiable dans nos documents publics. Vous pouvez reformuler votre question ou nous contacter pour un accompagnement.";

const DEFAULT_SUGGESTIONS = [
  "Quel est le delai d'intervention Premium ?",
  "Comment resilier le contrat ?",
  "Que couvre la formule VIP ?",
  "Quels sont les moyens de paiement ?",
];

const STOP_WORDS = new Set([
  "alors",
  "au",
  "aux",
  "ce",
  "ces",
  "comment",
  "dans",
  "de",
  "des",
  "du",
  "est",
  "et",
  "il",
  "je",
  "la",
  "le",
  "les",
  "leur",
  "mais",
  "mes",
  "mon",
  "nous",
  "ou",
  "par",
  "pas",
  "pour",
  "quel",
  "quelle",
  "quelles",
  "quels",
  "que",
  "qui",
  "se",
  "ses",
  "sur",
  "tes",
  "ton",
  "tu",
  "un",
  "une",
  "vos",
  "votre",
]);

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function scoreChunk(question: string, chunk: KnowledgeChunk): { score: number; matchedKeywords: string[] } {
  const normalizedQuestion = normalizeText(question);
  const tokens = tokenize(question);
  const content = normalizeText(`${chunk.sectionTitle} ${chunk.content} ${chunk.keywords.join(" ")}`);
  const matchedKeywords = new Set<string>();
  let score = 0;

  for (const keyword of chunk.keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedKeyword && normalizedQuestion.includes(normalizedKeyword)) {
      score += normalizedKeyword.includes(" ") ? 8 : 5;
      matchedKeywords.add(keyword);
    }
  }

  for (const token of tokens) {
    if (content.includes(token)) {
      score += 2;
      matchedKeywords.add(token);
    }
  }

  if (normalizedQuestion.includes("delai") && content.includes("jours ouvres")) {
    score += 4;
  }

  return { score, matchedKeywords: Array.from(matchedKeywords) };
}

function buildAnswer(question: string, chunk: KnowledgeChunk): string {
  const normalizedQuestion = normalizeText(question);

  if (normalizedQuestion.includes("delai")) {
    return `${chunk.content} Selon nos ${chunk.sourceTitle}.`;
  }

  if (normalizedQuestion.includes("resili")) {
    return `${chunk.content} Retrouvez le detail dans ${chunk.sourceTitle}.`;
  }

  return `${chunk.content} Source: ${chunk.sourceTitle}, section ${chunk.sectionTitle}.`;
}

function buildSuggestedQuestions(question: string, chunk: KnowledgeChunk): string[] {
  const normalizedQuestion = normalizeText(question);
  const normalizedSection = normalizeText(`${chunk.sectionTitle} ${chunk.content}`);

  if (normalizedQuestion.includes("delai") || normalizedSection.includes("jours ouvres")) {
    return [
      "Que couvre la formule Premium ?",
      "Que couvre la formule VIP ?",
      "Quels sont les tarifs de depart ?",
    ];
  }

  if (
    normalizedQuestion.includes("resili") ||
    normalizedQuestion.includes("arreter") ||
    normalizedSection.includes("retractation") ||
    normalizedSection.includes("resiliation")
  ) {
    return [
      "Quel est le delai de retractation ?",
      "Quels sont les moyens de paiement ?",
      "Quand la visite annuelle est-elle planifiee ?",
    ];
  }

  if (normalizedSection.includes("paiement") || normalizedQuestion.includes("paiement")) {
    return [
      "Le prix peut-il evoluer au renouvellement ?",
      "Comment resilier le contrat ?",
      "Quels sont les tarifs de depart ?",
    ];
  }

  if (
    normalizedQuestion.includes("vip") ||
    normalizedQuestion.includes("premium") ||
    normalizedQuestion.includes("standard") ||
    normalizedSection.includes("formule")
  ) {
    return [
      "Quel est le delai d'intervention Premium ?",
      "Quels sont les tarifs de depart ?",
      "Quels equipements sont couverts ?",
    ];
  }

  return DEFAULT_SUGGESTIONS.slice(0, 3);
}

export function answerPublicQuestion(question: string, chunks: KnowledgeChunk[]): ChatbotAnswerResult {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) {
    return { kind: "fallback", answer: FALLBACK_ANSWER, suggestedQuestions: DEFAULT_SUGGESTIONS };
  }

  const ranked = chunks
    .map((chunk) => ({ chunk, ...scoreChunk(trimmedQuestion, chunk) }))
    .sort((a, b) => b.score - a.score);

  const bestMatch = ranked[0];
  if (!bestMatch || bestMatch.score < 6) {
    return { kind: "fallback", answer: FALLBACK_ANSWER, suggestedQuestions: DEFAULT_SUGGESTIONS };
  }

  return {
    kind: "answer",
    answer: buildAnswer(trimmedQuestion, bestMatch.chunk),
    sourceTitle: bestMatch.chunk.sourceTitle,
    sectionTitle: bestMatch.chunk.sectionTitle,
    matchedKeywords: bestMatch.matchedKeywords,
    suggestedQuestions: buildSuggestedQuestions(trimmedQuestion, bestMatch.chunk),
  };
}
