import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/lib/ai-engine.server.ts", import.meta.url), "utf8");

const checks = [
  [
    "AI backend cannot write conversation state",
    !/\.from\(["']conversations["']\)\s*\.update\s*\(/.test(source),
  ],
  [
    "No legacy AI handoff side-effect remains",
    !source.includes("human_handoff_requested") && !source.includes("handoffRequired"),
  ],
  [
    "Model handoff marker is handled as output only",
    source.includes('const modelRequestedHandoff = answer.includes(handoffMarker);') &&
      source.includes("const safeAnswer = customerRequestedHuman || modelRequestedHandoff || modelClaimsOperationalControl") &&
      source.includes("const modelClaimsOperationalControl ="),
  ],
  [
    "The final system prompt explicitly denies operational authority",
    source.includes("LIMITE DE AUTORIZAÇÃO — REGRA INEGOCIÁVEL") &&
      source.includes("Não tens ferramentas nem autorização para transferir"),
  ],
  [
    "The customer-facing answer does not claim a transfer occurred",
    source.includes("Não consigo efectuar uma transferência automática nem alterar o estado desta conversa."),
  ],
];

let failed = false;
for (const [name, passed] of checks) {
  process.stdout.write(`${passed ? "PASS" : "FAIL"} — ${name}\n`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
