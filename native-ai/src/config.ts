import "dotenv/config";
import {z} from "zod";

const blankToUndefined=(value:unknown)=>value===""?undefined:value;

const schema=z.object({
 NODE_ENV:z.preprocess(blankToUndefined,z.string().default("development")),
 AI_WORKER_ENABLED:z.preprocess(blankToUndefined,z.enum(["true","false"]).default("false")).transform(v=>v==="true"),
 AI_RESULT_CALLBACK_URL:z.preprocess(blankToUndefined,z.string().url()),
 PORT:z.preprocess(blankToUndefined,z.coerce.number().default(8080)),
 SUPABASE_URL:z.preprocess(blankToUndefined,z.string().url()),
 SUPABASE_SERVICE_ROLE_KEY:z.preprocess(blankToUndefined,z.string().min(1)),
 AI_INTERNAL_SECRET:z.preprocess(blankToUndefined,z.string().min(16)),
 ORCHESTRATOR_URL:z.preprocess(blankToUndefined,z.string().url().optional()),
 ORCHESTRATOR_API_KEY:z.preprocess(blankToUndefined,z.string().min(32).optional()),
 TENANT_SIGNING_SECRET:z.preprocess(blankToUndefined,z.string().min(32).optional()),
 ORCHESTRATOR_TIMEOUT_MS:z.preprocess(blankToUndefined,z.coerce.number().int().min(5000).max(60000).default(25000)),
 AI_MODEL:z.preprocess(blankToUndefined,z.string().default("gemini-3.8-flash")),
 AI_MAX_OUTPUT_TOKENS:z.preprocess(blankToUndefined,z.coerce.number().int().positive().max(16384).default(700)),
 AI_TEMPERATURE:z.preprocess(blankToUndefined,z.coerce.number().min(0).max(2).default(0.35)),
 AI_HISTORY_LIMIT:z.preprocess(blankToUndefined,z.coerce.number().int().positive().max(100).default(8)),
 AI_KNOWLEDGE_LIMIT:z.preprocess(blankToUndefined,z.coerce.number().int().positive().max(50).default(12)),
 AI_RATE_LIMIT_PER_MINUTE:z.preprocess(blankToUndefined,z.coerce.number().int().positive().max(1000).default(20)),
 AI_QUEUE_POLL_MS:z.preprocess(blankToUndefined,z.coerce.number().int().min(100).max(5000).default(500)),
 AI_QUEUE_WAIT_MS:z.preprocess(blankToUndefined,z.coerce.number().int().min(3000).max(24000).default(23000))
}).passthrough();

export const config=schema.parse(process.env);
