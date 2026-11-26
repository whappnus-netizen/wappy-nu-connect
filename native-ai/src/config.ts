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
 AI_PROVIDER:z.preprocess(blankToUndefined,z.enum(["ollama","intelligence-router"]).default("ollama")),
 AI_ROUTER_BASE_URL:z.preprocess(blankToUndefined,z.string().url().optional()),
 AI_ROUTER_API_KEY:z.preprocess(blankToUndefined,z.string().min(32).optional()),
 AI_ROUTER_TIMEOUT_MS:z.preprocess(blankToUndefined,z.coerce.number().int().min(5000).max(180000).default(90000)),
 AI_MODEL:z.preprocess(blankToUndefined,z.string().default("qwen2.5vl:3b")),
 AI_OLLAMA_BASE_URL:z.preprocess(blankToUndefined,z.string().url().optional()),
 AI_OLLAMA_API_KEY:z.preprocess(blankToUndefined,z.string().min(32).optional()),
 AI_OLLAMA_MODEL:z.preprocess(blankToUndefined,z.string().default("qwen2.5vl:3b")),
 AI_OLLAMA_TIMEOUT_MS:z.preprocess(blankToUndefined,z.coerce.number().int().min(5000).max(60000).default(45000)),
 AI_OLLAMA_NUM_THREADS:z.preprocess(blankToUndefined,z.coerce.number().int().min(1).max(32).default(4)),
 AI_OLLAMA_CONTEXT_LENGTH:z.preprocess(blankToUndefined,z.coerce.number().int().min(1024).max(32768).default(4096)),
 // Short WhatsApp replies reserve less of the 4k context for output, leaving
 // enough room for compact business instructions and recent conversation.
 AI_MAX_OUTPUT_TOKENS:z.preprocess(blankToUndefined,z.coerce.number().int().positive().max(8192).default(512)),
 AI_TEMPERATURE:z.preprocess(blankToUndefined,z.coerce.number().min(0).max(2).default(0.3)),
 AI_HISTORY_LIMIT:z.preprocess(blankToUndefined,z.coerce.number().int().positive().max(100).default(8)),
 AI_KNOWLEDGE_LIMIT:z.preprocess(blankToUndefined,z.coerce.number().int().positive().max(50).default(12)),
 AI_RATE_LIMIT_PER_MINUTE:z.preprocess(blankToUndefined,z.coerce.number().int().positive().max(1000).default(20)),
 AI_QUEUE_POLL_MS:z.preprocess(blankToUndefined,z.coerce.number().int().min(100).max(5000).default(500)),
 AI_QUEUE_WAIT_MS:z.preprocess(blankToUndefined,z.coerce.number().int().min(3000).max(24000).default(23000))
}).passthrough();

export const config=schema.parse(process.env);
