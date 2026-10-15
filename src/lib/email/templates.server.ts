// Modelos transacionais WhappNus (HTML inline, compatível com Gmail/Outlook).
const APP_URL = "https://whappnus.online";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const kz = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString("pt-PT")} Kz` : "";
};
const dt = (v: unknown) => {
  if (!v) return "";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? "" : d.toLocaleString("pt-PT", { timeZone: "Africa/Luanda", dateStyle: "long", timeStyle: "short" });
};

function rows(items: Array<[string, string]>) {
  const r = items.filter(([, v]) => v);
  if (!r.length) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid #e5e7eb;border-radius:10px">${r
    .map(([k, v]) => `<tr><td style="padding:10px 14px;color:#6b7280;font-size:13px;border-bottom:1px solid #f1f5f9">${esc(k)}</td><td style="padding:10px 14px;color:#111827;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9">${esc(v)}</td></tr>`)
    .join("")}</table>`;
}

function button(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="background:#22c55e;border-radius:8px"><a href="${esc(href)}" style="display:inline-block;padding:14px 28px;color:#0b0f0c;font-weight:700;font-size:15px;text-decoration:none">${esc(label)}</a></td></tr></table>`;
}

export function layout(preheader: string, inner: string) {
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#111413;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111413;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="background:#0a0a0a;padding:22px 28px;border-radius:12px 12px 0 0"><span style="color:#22c55e;font-size:22px;font-weight:800;letter-spacing:2px">WHAPPNUS</span></td></tr>
<tr><td style="background:#ffffff;padding:32px 28px;color:#1f2937;font-size:15px;line-height:1.6">${inner}</td></tr>
<tr><td style="background:#0a0a0a;padding:18px 28px;border-radius:0 0 12px 12px;color:#9ca3af;font-size:12px;text-align:center">WhappNus — A tua operação, mais inteligente.<br><a href="${APP_URL}" style="color:#22c55e">whappnus.online</a></td></tr>
</table></td></tr></table></body></html>`;
}

export type TemplateCode =
  | "welcome"
  | "payment_pending"
  | "payment_approved"
  | "subscription_renewed"
  | "plan_changed"
  | "payment_cancelled"
  | "payment_refunded"
  | "subscription_expiring"
  | "subscription_expired";

export type Vars = Record<string, unknown>;

export function renderTemplate(code: TemplateCode, v: Vars): { subject: string; html: string } {
  const hi = `<p>Olá${v["name"] ? `, <strong>${esc(v["name"])}</strong>` : ""}!</p>`;
  const sign = `<p style="margin-top:28px">Com os melhores cumprimentos,<br><strong>Equipa WhappNus</strong></p>`;
  const support = `<p style="color:#6b7280;font-size:13px">Precisa de ajuda? Responda a este e-mail.</p>`;
  const go = button("Aceder à WhappNus", `${APP_URL}/dashboard`);
  const t = (subject: string, pre: string, body: string) => ({ subject, html: layout(pre, body + sign) });

  switch (code) {
    case "welcome":
      return t("A tua conta WhappNus está pronta", "Bem-vindo! Vê os primeiros passos.",
        `<h1 style="font-size:22px;margin:0 0 12px">Bem-vindo à WhappNus!</h1>${hi}<p>O teu e-mail foi confirmado${v["organization"] ? ` e a organização <strong>${esc(v["organization"])}</strong> está criada` : ""}.</p><p><strong>Primeiros passos:</strong></p><ol><li>Conecta o teu número de WhatsApp.</li><li>Configura a tua IA de atendimento.</li><li>Convida a tua equipa.</li></ol>${go}`);
    case "payment_pending":
      return t("Recebemos o teu pedido — pagamento pendente", "O teu pagamento está a ser processado.",
        `<h1 style="font-size:22px;margin:0 0 12px">Pagamento pendente</h1>${hi}<p>Recebemos o início do teu pagamento. Assim que for confirmado, o teu plano é activado automaticamente e enviamos-te uma confirmação.</p>${rows([["Plano", String(v["plan"] ?? "")], ["Valor", kz(v["amount"])], ["Referência", String(v["reference"] ?? "")], ["Estado", "Pendente"]])}<p>Ainda não precisas de fazer nada.</p>${support}`);
    case "payment_approved":
    case "subscription_renewed": {
      const renewed = code === "subscription_renewed";
      return t(renewed ? "Renovação confirmada — o teu plano WhappNus continua activo" : "Pagamento confirmado! O teu plano WhappNus está ativo",
        "Pagamento confirmado e plano activo.",
        `<h1 style="font-size:22px;margin:0 0 12px">${renewed ? "Renovação confirmada" : "Pagamento confirmado!"}</h1>${hi}<p>${renewed ? "O novo período da tua assinatura foi activado." : "O teu pagamento foi aprovado e o teu plano já está activo."}</p>${rows([["Organização", String(v["organization"] ?? "")], ["Plano", String(v["plan"] ?? "")], ["Valor pago", kz(v["amount"])], ["Estado", "Aprovado"], ["Aprovado em", dt(v["approved_at"])], ["Início do período", dt(v["period_start"])], ["Fim do período", dt(v["period_end"])], ["Referência", String(v["reference"] ?? "")]])}${v["features"] ? `<p><strong>Incluído no plano:</strong> ${esc(v["features"])}</p>` : ""}${go}${support}`);
    }
    case "plan_changed":
      return t("O teu plano WhappNus foi alterado", "A alteração de plano foi concluída.",
        `<h1 style="font-size:22px;margin:0 0 12px">Plano alterado</h1>${hi}${rows([["Plano anterior", String(v["old_plan"] ?? "")], ["Novo plano", String(v["plan"] ?? "")], ["Limites", String(v["features"] ?? "")]])}${go}`);
    case "payment_cancelled":
      return t("A tua compra WhappNus foi cancelada", "A compra foi cancelada.",
        `<h1 style="font-size:22px;margin:0 0 12px">Compra cancelada</h1>${hi}<p>A compra abaixo foi cancelada e nenhum plano foi activado.</p>${rows([["Plano", String(v["plan"] ?? "")], ["Valor", kz(v["amount"])], ["Referência", String(v["reference"] ?? "")]])}<p>Se quiseres, podes fazer um novo pedido a qualquer momento.</p>${button("Ver planos", `${APP_URL}/#planos`)}${support}`);
    case "payment_refunded":
      return t("Reembolso confirmado — WhappNus", "O reembolso foi confirmado.",
        `<h1 style="font-size:22px;margin:0 0 12px">Reembolso confirmado</h1>${hi}<p>O pagamento abaixo foi reembolsado e a assinatura associada foi encerrada.</p>${rows([["Plano", String(v["plan"] ?? "")], ["Valor", kz(v["amount"])], ["Referência", String(v["reference"] ?? "")]])}${support}`);
    case "subscription_expiring":
      return t(`O teu plano WhappNus expira ${Number(v["days"]) <= 0 ? "hoje" : `em ${esc(v["days"])} dia(s)`}`, "Renova para não perder o acesso.",
        `<h1 style="font-size:22px;margin:0 0 12px">A tua assinatura está a terminar</h1>${hi}${rows([["Plano", String(v["plan"] ?? "")], ["Expira em", dt(v["period_end"])]])}<p>Renova para manter o atendimento por WhatsApp, a IA e as automações a funcionar sem interrupções.</p>${button("Renovar agora", `${APP_URL}/#planos`)}`);
    case "subscription_expired":
      return t("O teu plano WhappNus terminou", "Renova para reactivar a tua conta.",
        `<h1 style="font-size:22px;margin:0 0 12px">A tua assinatura terminou</h1>${hi}<p>O plano <strong>${esc(v["plan"] ?? "")}</strong> expirou. O atendimento automático, a IA e as automações ficam suspensos até renovares. Os teus dados continuam guardados.</p>${button("Renovar plano", `${APP_URL}/#planos`)}${support}`);
  }
}

export const TEMPLATE_CODES: TemplateCode[] = ["welcome", "payment_pending", "payment_approved", "subscription_renewed", "plan_changed", "payment_cancelled", "payment_refunded", "subscription_expiring", "subscription_expired"];
