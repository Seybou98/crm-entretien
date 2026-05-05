import { useMemo, useState } from "react";

import knowledgeBase from "./generated/public-knowledge.json";
import { answerPublicQuestion } from "./engine/publicChatbot";
import type { ChatbotAnswerResult, KnowledgeChunk } from "./types";

type ChatMessage =
  | { id: string; role: "assistant"; text: string; sourceTitle?: string; sectionTitle?: string; suggestedQuestions?: string[] }
  | { id: string; role: "user"; text: string };

const DEFAULT_SUGGESTIONS = [
  "Quel est le delai d'intervention Premium ?",
  "Comment resilier le contrat ?",
  "Que couvre la formule VIP ?",
  "Quels sont les moyens de paiement ?",
];

function toAssistantMessage(result: ChatbotAnswerResult): ChatMessage {
  if (result.kind === "fallback") {
    return {
      id: crypto.randomUUID(),
      role: "assistant",
      text: result.answer,
      suggestedQuestions: result.suggestedQuestions,
    };
  }

  return {
    id: crypto.randomUUID(),
    role: "assistant",
    text: result.answer,
    sourceTitle: result.sourceTitle,
    sectionTitle: result.sectionTitle,
    suggestedQuestions: result.suggestedQuestions,
  };
}

export function PublicChatbotWidget({
  embedded = false,
  title = "Assistant LabelEnergie",
  subtitle = "Reponses scriptes basees sur les documents publics",
  welcomeMessage = "Bonjour, je peux repondre a vos questions a partir des CGV, de la FAQ publique et de la documentation du site.",
  suggestions = DEFAULT_SUGGESTIONS,
  placeholder = "Posez une question sur les formules, les CGV, la resiliation...",
}: {
  embedded?: boolean;
  title?: string;
  subtitle?: string;
  welcomeMessage?: string;
  suggestions?: string[];
  placeholder?: string;
}) {
  const chunks = useMemo(() => knowledgeBase as KnowledgeChunk[], []);
  const initialMessages = useMemo<ChatMessage[]>(
    () => [
      {
        id: "welcome",
        role: "assistant",
        text: welcomeMessage,
      },
    ],
    [welcomeMessage]
  );
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);

  function submitQuestion(question: string) {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) return;

    const result = answerPublicQuestion(trimmedQuestion, chunks);

    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: trimmedQuestion },
      toAssistantMessage(result),
    ]);
    setInput("");
    setIsOpen(true);
  }

  const panel = (
    <div
      style={{
        width: embedded ? "100%" : "min(380px, calc(100vw - 24px))",
        maxHeight: embedded ? "none" : "min(620px, calc(100vh - 120px))",
        background: "rgba(255,255,255,0.98)",
        border: "1px solid rgba(13,27,42,0.08)",
        borderRadius: 24,
        boxShadow: embedded ? "var(--shadow-sm)" : "0 24px 80px rgba(13,27,42,0.18)",
        overflow: "hidden",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          padding: "18px 18px 14px",
          background: "linear-gradient(135deg, rgba(0,184,220,0.14), rgba(0,201,167,0.12))",
          borderBottom: "1px solid rgba(13,27,42,0.06)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{subtitle}</div>
        </div>
        {!embedded ? (
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: 22,
              lineHeight: 1,
              cursor: "pointer",
            }}
            aria-label="Fermer le chat"
          >
            ×
          </button>
        ) : null}
      </div>

      <div style={{ padding: 16, display: "grid", gap: 12, background: "#F7F9FC" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => submitQuestion(suggestion)}
              style={{
                border: "1px solid rgba(0,184,220,0.16)",
                background: "#fff",
                color: "var(--text-secondary)",
                borderRadius: 999,
                padding: "8px 12px",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gap: 10,
            maxHeight: embedded ? 420 : 320,
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          {messages.map((message) => (
            <div
              key={message.id}
              style={{
                justifySelf: message.role === "user" ? "end" : "stretch",
                maxWidth: "92%",
                padding: "12px 14px",
                borderRadius: message.role === "user" ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
                background: message.role === "user" ? "linear-gradient(135deg, var(--cyan), var(--teal))" : "#fff",
                color: message.role === "user" ? "#fff" : "var(--text-secondary)",
                boxShadow: message.role === "user" ? "none" : "var(--shadow-sm)",
              }}
            >
              <div style={{ fontSize: 14, lineHeight: 1.55 }}>{message.text}</div>
              {message.role === "assistant" && message.sourceTitle ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  Source: {message.sourceTitle}
                  {message.sectionTitle ? ` · ${message.sectionTitle}` : ""}
                </div>
              ) : null}
              {message.role === "assistant" && message.suggestedQuestions?.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {message.suggestedQuestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => submitQuestion(suggestion)}
                      style={{
                        border: "1px solid rgba(0,184,220,0.18)",
                        background: "rgba(0,184,220,0.06)",
                        color: "var(--text-secondary)",
                        borderRadius: 999,
                        padding: "6px 10px",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitQuestion(input);
          }}
          style={{ display: "grid", gap: 10 }}
        >
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={placeholder}
            rows={3}
            style={{
              width: "100%",
              resize: "none",
              borderRadius: 16,
              border: "1px solid rgba(13,27,42,0.1)",
              padding: "12px 14px",
              fontSize: 14,
              outline: "none",
              background: "#fff",
            }}
          />
          <button type="submit" className="cta-primary-premium" style={{ width: "100%", justifyContent: "center" }}>
            Envoyer
          </button>
        </form>
      </div>
    </div>
  );

  if (embedded) {
    return panel;
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        // Keep below modals (Auth/Contract) which use zIndex ~1000.
        zIndex: 900,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 12,
      }}
    >
      {isOpen ? panel : null}

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        style={{
          border: "none",
          borderRadius: 999,
          padding: "14px 18px",
          background: "linear-gradient(135deg, var(--cyan), var(--teal))",
          color: "#fff",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 20px 40px rgba(0,184,220,0.28)",
        }}
      >
        Besoin d'aide ?
      </button>
    </div>
  );
}
