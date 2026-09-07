/**
 * Wappy Nus — registo de providers de WhatsApp (SERVER-ONLY).
 *
 * Única função da app que decide qual implementação usar. Acrescentar um
 * provedor novo no futuro é registá-lo aqui.
 */
import { metaProvider, mockProvider, type ProviderName, type WhatsAppProvider } from "./provider.server";
import { qrProvider } from "./qr.server";

export function providerByName(name: string | null | undefined): WhatsAppProvider {
  switch (name) {
    case "qr":
      return qrProvider;
    case "mock":
      return mockProvider;
    case "meta_cloud":
    case "meta":
    default:
      return process.env["WHATSAPP_PROVIDER"] === "mock" ? mockProvider : metaProvider;
  }
}

export function providerNameOf(row: { provider?: string | null }): ProviderName {
  return row.provider === "qr" ? "qr" : "meta_cloud";
}

export const PROVIDER_LABEL: Record<string, string> = {
  meta_cloud: "WhatsApp — Cloud API",
  qr: "WhatsApp — QR",
  mock: "WhatsApp — mock",
};
