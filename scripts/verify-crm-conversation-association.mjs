import { readFile } from "node:fs/promises";

const [pipeline, inbox, crm, backfill, migration] = await Promise.all([
  readFile(new URL("../src/lib/whatsapp/pipeline.server.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/routes/_authenticated/inbox.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/routes/_authenticated/crm.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/crm-backfill.functions.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261127160000_add_deal_conversation_link.sql", import.meta.url), "utf8"),
]);

const checks = [
  ["Database relation enforces same-tenant conversation ownership", migration.includes("foreign key (conversation_id, organization_id)") && migration.includes("references public.conversations (id, organization_id)")],
  ["Automated CRM lead creation stores the originating conversation", /contact_id: res\.contact_id,\s*conversation_id: res\.conversation_id/.test(pipeline)],
  ["Inbox-created opportunities store the selected conversation", /contact_id: active\.contact_id,\s*conversation_id: active\.id/.test(inbox)],
  ["Backfill associates each contact with its latest conversation", backfill.includes("conversationIdByContact") && backfill.includes("conversation_id: context.conversationIdByContact.get(contact.id) ?? null")],
  ["CRM reads and displays the conversation association", crm.includes("conversation_id, status") && crm.includes("Ligada a uma conversa WhatsApp")],
  ["Existing deals are not rewritten by the migration", migration.includes("Existing deals remain valid") && !/update\s+public\.deals/i.test(migration)],
];

let failed = false;
for (const [name, passed] of checks) {
  process.stdout.write(`${passed ? "PASS" : "FAIL"} — ${name}\n`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
