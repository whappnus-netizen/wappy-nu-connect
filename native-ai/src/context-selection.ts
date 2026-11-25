export function selectRelevantText(value: unknown, maxChars: number, query: string): string {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source || maxChars <= 0) return "";
  if (source.length <= maxChars) return source;

  const normalize = (value: string) => Array.from(value.normalize("NFD"))
    .filter((character) => (character.codePointAt(0) ?? 0) < 768)
    .join("")
    .toLocaleLowerCase("pt-AO");
  const words = (value: string) => normalize(value).split(" ")
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length >= 3);
  const queryTerms = new Set(words(query));
  const units = source.split(String.fromCharCode(10) + String.fromCharCode(10))
    .map((unit) => unit.trim()).filter(Boolean);
  const marker = "[Outras instruções omitidas por limite de contexto.]";
  const budget = Math.max(0, maxChars - marker.length - 2);
  const ranked = units.map((text, index) => {
    const score = words(text).reduce((total, word) => total + (queryTerms.has(word) ? 2 : 0), 0)
      + (index === 0 ? 3 : 0)
      + (["nunca", "obrigatorio", "obrigatoria", "proibido", "proibida", "sempre", "identidade"].some((term) => normalize(text).includes(term)) ? 8 : 0);
    return { text, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: typeof ranked = [];
  let used = 0;
  for (const unit of ranked) {
    const cost = unit.text.length + (selected.length ? 2 : 0);
    if (used + cost <= budget) {
      selected.push(unit);
      used += cost;
    }
  }
  selected.sort((a, b) => a.index - b.index);
  const result = selected.map((unit) => unit.text).join(String.fromCharCode(10, 10));
  return (result ? result + String.fromCharCode(10, 10) : "") + marker;
}
