import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const sources = [
  {
    id: "cgv",
    title: "CGV",
    // Le fichier peut varier selon les environnements (Netlify build / local).
    // On le cherche dans le projet courant.
    filePath: path.resolve(projectRoot, "src/utils/CGV LABEL ENERGIE.txt"),
    type: "txt",
  },
  {
    id: "faq",
    title: "FAQ",
    filePath: path.resolve(projectRoot, "src/chatbot/knowledge/faq-public.md"),
    type: "md",
  },
  {
    id: "site-docs",
    title: "Documentation publique",
    filePath: path.resolve(projectRoot, "src/chatbot/knowledge/site-public.md"),
    type: "md",
  },
];

function normalizeText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractKeywords(sectionTitle, content) {
  const normalized = normalizeText(`${sectionTitle} ${content}`);
  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 4);

  const phrases = [];
  if (normalized.includes("5 jours ouvres")) phrases.push("5 jours ouvres");
  if (normalized.includes("3 jours ouvres")) phrases.push("3 jours ouvres");
  if (normalized.includes("7 jours ouvres")) phrases.push("7 jours ouvres");
  if (normalized.includes("14 jours")) phrases.push("14 jours");
  if (normalized.includes("prelevement automatique")) phrases.push("prelevement automatique");
  if (normalized.includes("main d oeuvre")) phrases.push("main d oeuvre");

  return unique([...phrases, ...tokens]).slice(0, 18);
}

function chunkMarkdown(source, raw) {
  const sections = raw
    .split(/^##\s+/m)
    .map((part) => part.trim())
    .filter(Boolean);

  return sections.map((section, index) => {
    const [titleLine, ...bodyLines] = section.split("\n");
    const sectionTitle = titleLine.replace(/^#\s+/, "").trim();
    const content = bodyLines.join(" ").replace(/\s+/g, " ").trim();

    return {
      id: `${source.id}-${index + 1}`,
      sourceId: source.id,
      sourceTitle: source.title,
      sectionTitle,
      content,
      keywords: extractKeywords(sectionTitle, content),
    };
  });
}

function chunkText(source, raw) {
  const sections = raw
    .split(/\n(?=\d+(?:\.\d+)?\s*-)/)
    .map((part) => part.trim())
    .filter(Boolean);

  return sections.map((section, index) => {
    const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
    const sectionTitle = lines[0].slice(0, 80);
    const content = lines.slice(1).join(" ").replace(/\s+/g, " ").trim() || lines[0];

    return {
      id: `${source.id}-${index + 1}`,
      sourceId: source.id,
      sourceTitle: source.title,
      sectionTitle,
      content,
      keywords: extractKeywords(sectionTitle, content),
    };
  });
}

async function buildKnowledgeBase() {
  const allChunks = [];

  for (const source of sources) {
    let raw = "";
    try {
      raw = await readFile(source.filePath, "utf8");
    } catch (e) {
      // Non bloquant : on peut déployer le site même si un fichier de connaissance est absent.
      console.warn(`[chatbot] source "${source.id}" introuvable → ignorée:`, source.filePath);
      continue;
    }
    const chunks = source.type === "md" ? chunkMarkdown(source, raw) : chunkText(source, raw);
    allChunks.push(...chunks.filter((chunk) => chunk.content.length >= 40));
  }

  const outputDir = path.resolve(projectRoot, "src/chatbot/generated");
  const outputPath = path.resolve(outputDir, "public-knowledge.json");

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(allChunks, null, 2) + "\n", "utf8");

  console.log(`Generated ${allChunks.length} chatbot knowledge chunks in ${path.relative(projectRoot, outputPath)}`);
}

buildKnowledgeBase().catch((error) => {
  console.error("Failed to build chatbot knowledge base");
  console.error(error);
  process.exitCode = 1;
});
