export type KnowledgeChunk = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  sectionTitle: string;
  content: string;
  keywords: string[];
};

export type ChatbotAnswerResult =
  | {
      kind: "answer";
      answer: string;
      sourceTitle: string;
      sectionTitle: string;
      matchedKeywords: string[];
      suggestedQuestions: string[];
    }
  | {
      kind: "fallback";
      answer: string;
      suggestedQuestions: string[];
    };
