import type {ChatMessage,MediaAttachment} from "./types.js";

export interface ProviderResponse {
 text:string;
 provider:string;
 model:string;
}
export interface AIProvider {
 generate(
  messages:ChatMessage[],
  options:{model:string;temperature:number;maxTokens:number},
  attachments?:MediaAttachment[]
 ):Promise<ProviderResponse>;
}
