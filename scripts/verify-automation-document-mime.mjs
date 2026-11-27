import { readFile } from "node:fs/promises";

const [ui, pipeline, migration] = await Promise.all([
  readFile(new URL("../src/routes/_authenticated/automacoes.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/whatsapp/pipeline.server.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261127140000_allow_document_mime_types_for_automation_media.sql", import.meta.url), "utf8"),
]);

const documentMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
];

const checks = [
  ["UI and backend both whitelist each supported document MIME", documentMimeTypes.every(mime => ui.includes(`"${mime}"`) && pipeline.includes(`"${mime}"`))],
  ["Storage migration allows every supported document MIME", documentMimeTypes.every(mime => migration.includes(`'${mime}'`))],
  ["Document uploads are no longer accepted without MIME validation", !/step\.kind\s*===\s*"document"\s*\?\s*true/.test(ui)],
  ["Generic binary MIME is not accepted as a document", !documentMimeTypes.includes("application/octet-stream")],
  ["Existing bucket MIME types and size limit are preserved", migration.includes("coalesce(allowed_mime_types") && migration.includes("where id = 'automation-media'")],
  ["Backend passes normalized MIME to the WhatsApp provider", pipeline.includes("mimeType: normalizedMimeType")],
];

let failed = false;
for (const [name, passed] of checks) {
  process.stdout.write(`${passed ? "PASS" : "FAIL"} — ${name}\n`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
