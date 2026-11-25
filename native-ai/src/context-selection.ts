export function selectRelevantText(value: unknown, maxChars: number, query: string): string {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source || maxChars <= 0) return "";
  if (source.length <= maxChars) return source;
  const terms = new Set(query.toLocaleLowerCase("pt-AO").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").match(/[\\p{L}\\p{N}]{3,}/gu) ?? []);
  const units = source.split(/\\n\\s*\\n+/).map((text) => text.trim()).filter(Boolean);
  const marker = "[Outras instruções omitidas por limite de contexto.]";
  const budget = Math.max(0, maxChars - marker.length - 2);
  const ranked = units.map((text, index) => {
    const words = text.toLocaleLowerCase("pt-AO").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").match(/[\\p{L}\\p{N}]{3,}/gu) ?? [];
    const score = words.reduce((sum, word) => sum + (terms.has(word) ? 2 : 0), 0) + (index === 0 ? 3 : 0) + (/\\b(nunca|obrigat[oó]ri[oa]|proibid[oa]|sempre|identidade)\\b/i.test(text) ? 8 : 0);
    return { text, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: typeof ranked = [];
  let used = 0;
  for (const unit of ranked) {
    const cost = unit.text.length + (selected.length ? 2 : 0);
    if (used + cost <= budget) { selected.push(unit); used += cost; }
  }
  selected.sort((a, b) => a.index - b.index);
  const result = selected.map((unit) => unit.text).join("\\n\\n");
  return (result ? result + "\\n\\n" : "") + marker;
}
