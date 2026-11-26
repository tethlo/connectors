// Deterministic, LLM-free tool routing baseline.
// It ranks tools by word overlap between a request and each tool's name + description (TF-IDF weighted).
// If even this crude router finds the right tool, the descriptions are distinct and use the user's words;
// the real model (eval/run-claude.ts) is the final judge.

export interface ToolText {
  name: string;
  description?: string;
}

const STOP = new Set(
  "a an and are as at be by can do does for from get give how i if in into is it its just me my now of on or our over please right the their them then there this to up use we what when which who why will with you your".split(
    " ",
  ),
);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/_/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s|ly)$/, "").replace(/e$/, ""))
    .filter((w) => w.length > 1);
}

export function rank(prompt: string, tools: ToolText[]): string[] {
  const docs = tools.map((t) => ({ name: t.name, words: [...tokens(t.name), ...tokens(t.name), ...tokens(t.description ?? "")] }));
  const df = new Map<string, number>();
  for (const doc of docs) for (const w of new Set(doc.words)) df.set(w, (df.get(w) ?? 0) + 1);
  const query = tokens(prompt);
  const scored = docs.map((doc) => {
    let score = 0;
    for (const w of query) {
      const tf = doc.words.filter((x) => x === w).length;
      if (tf) score += (1 + Math.log(tf)) * Math.log(1 + docs.length / (df.get(w) ?? 1));
    }
    return { name: doc.name, score: score / Math.sqrt(doc.words.length) };
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => s.name);
}
