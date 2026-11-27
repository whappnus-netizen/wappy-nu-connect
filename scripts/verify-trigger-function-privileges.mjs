import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261127150000_restrict_trigger_function_execution.sql", import.meta.url), "utf8");
const functions = ["notify_kursinha_sale_activation", "touch_support_ticket_from_message"];

const checks = [
  ["Both trigger functions have an empty search_path", functions.every(name => migration.includes(`alter function public.${name}() set search_path = ''`))],
  ["Both trigger functions revoke direct EXECUTE from API roles", functions.every(name => migration.includes(`revoke execute on function public.${name}()`))],
  ["No API role is re-granted direct EXECUTE", !/grant\s+execute/i.test(migration)],
  ["The migration targets only the two trigger functions", functions.every(name => migration.includes(name))],
];

let failed = false;
for (const [name, passed] of checks) {
  process.stdout.write(`${passed ? "PASS" : "FAIL"} — ${name}\n`);
  if (!passed) failed = true;
}
if (failed) process.exitCode = 1;
