import test from "node:test";
import assert from "node:assert/strict";
import { selectRelevantText } from "../src/context-selection.js";

test("keeps complete instruction text when it fits", () => {
  const source = "Identidade do agente.\n\nRegra comercial importante.";
  assert.equal(selectRelevantText(source, 500, "identidade"), source);
});

test("prioritizes rules relevant to the current message", () => {
  const source = [
    "A empresa foi fundada em 2010 e tem uma história longa.",
    "O agente nunca deve inventar preços nem prazos.",
    "O produto principal é um serviço de entregas para restaurantes.",
  ].join("\n\n");
  const result = selectRelevantText(source, 230, "preço do serviço de entregas");
  assert.match(result, /nunca deve inventar preços/);
  assert.match(result, /serviço de entregas/);
});

test("retains whole instruction units rather than slicing fragments", () => {
  const source = [
    "PRIMEIRA REGRA COMPLETA: respeita a identidade do agente.",
    "SEGUNDA REGRA COMPLETA: nunca inventes preços nem prazos.",
    "TERCEIRA REGRA COMPLETA: encaminha pedidos humanos para a equipa.",
    "QUARTA REGRA COMPLETA: confirma disponibilidade antes de prometer.",
  ].join("\n\n");
  const result = selectRelevantText(source, 180, "preços");
  assert.match(result, /SEGUNDA REGRA COMPLETA/);
  assert.match(result, /Outras instruções omitidas/);
  assert.doesNotMatch(result, /SEGUNDA REGRA COMPLETA:[^\n]*TERCEIRA REGRA/);
});

test("returns an empty string for empty input", () => {
  assert.equal(selectRelevantText("  ", 100, "qualquer coisa"), "");
});
