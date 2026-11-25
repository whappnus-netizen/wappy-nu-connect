import "dotenv/config";
import {z} from "zod";

const schema=z.object({
 NODE_ENV:z.string().default("development"),
 PORT:z.coerce.number().default(8080),
 SUPABASE_URL:z.string().url(),
 SUPABASE_SERVICE_ROLE_KEY:z.string().min(1),
 AI_INTERNAL_SECRET:z.string().min(16),
 AI_PROVIDER:z.literal("ollama").default("ollama"),
 AI_MODEL:z.string().default("qwen2.5vl:3b"),
 AI_OLLAMA_BASE_URL:z.string().url(),
 AI_OLLAMA_API_KEY:z.string().min(32),
 AI_OLLAMA_MODEL:z.string().default("qwen2.5vl:3b"),
 AI_OLLAMA_TIMEOUT_MS:z.coerce.number().int().min(5000).max(60000).default(45000),
 AI_OLLAMA_NUM_THREADS:z.coerce.number().int().min(1).max(32).default(4),
 AI_OLLAMA_CONTEXT_LENGTH:z.coerce.number().int().min(1024).max(32768).default(4096),
 // Short WhatsApp replies reserve less of the 4k context for output, leaving
 // enough room for compact business instructions and recent conversation.
 AI_MAX_OUTPUT_TOKENS:z.coerce.number().int().positive().max(8192).default(512),
 AI_TEMPERATURE:z.coerce.number().min(0).max(2).default(0.3),
 AI_HISTORY_LIMIT:z.coerce.number().int().positive().max(100).default(8),
 AI_KNOWLEDGE_LIMIT:z.coerce.number().int().positive().max(50).default(12),
 AI_RATE_LIMIT_PER_MINUTE:z.coerce.number().int().positive().max(1000).default(20),
 AI_QUEUE_POLL_MS:z.coerce.number().int().min(100).max(5000).default(500),
 AI_QUEUE_WAIT_MS:z.coerce.number().int().min(3000).max(24000).default(23000)
}).passthrough();

export const config=schema.parse(process.env);
