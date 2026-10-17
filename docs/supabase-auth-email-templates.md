# Modelos de e-mail do Supabase Auth (colar no painel)

Supabase → Authentication → URL Configuration:
- Site URL: `https://whappnus.online` (não pode ser `http://localhost:3000`)
- Redirect URLs: `https://whappnus.online/**` e, apenas para desenvolvimento, `http://localhost:3000/**`.
- Depois de alterar, guardar a configuração e testar com uma conta nova.

Supabase → Authentication → Email Templates.

## Confirm signup
Assunto: `Bem-vindo à WhappNus! Confirma o teu e-mail`

```html
<div style="background:#111413;padding:24px 12px;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto">
<div style="background:#0a0a0a;padding:22px 28px;border-radius:12px 12px 0 0;color:#22c55e;font-size:22px;font-weight:800;letter-spacing:2px">WHAPPNUS</div>
<div style="background:#fff;padding:32px 28px;color:#1f2937;font-size:15px;line-height:1.6">
<h1 style="font-size:22px;margin:0 0 6px">Bem-vindo à WhappNus!</h1><p style="color:#6b7280;margin:0 0 16px">Estamos felizes por te receber.</p>
<p>Olá{{ if .Data.full_name }}, <strong>{{ .Data.full_name }}</strong>{{ end }}, bem-vindo à WhappNus! Obrigado por te juntares à nossa plataforma.</p>
<p>A WhappNus ajuda-te a organizar o atendimento, acompanhar conversas e aproveitar cada oportunidade de venda.</p>
<p>Para proteger a tua conta, confirma o teu endereço de e-mail:</p>
<p style="margin:24px 0"><a href="https://whappnus.online/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup" style="background:#22c55e;color:#0b0f0c;padding:14px 28px;border-radius:8px;font-weight:700;text-decoration:none">Confirmar o meu e-mail</a></p>
<p style="font-size:13px;color:#6b7280">Se o botão não funcionar, copia este link para o navegador:<br>https://whappnus.online/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup</p>
<p style="font-size:13px;color:#6b7280">Se não criaste esta conta, ignora este e-mail.</p>
<p>Com os melhores cumprimentos,<br><strong>Equipa WhappNus</strong></p></div>
<div style="background:#0a0a0a;padding:18px;border-radius:0 0 12px 12px;color:#9ca3af;font-size:12px;text-align:center">WhappNus — A tua operação, mais inteligente.</div></div></div>
```

## Reset password
Assunto: `Recupere o acesso à sua conta WhappNus`

```html
<div style="background:#111413;padding:24px 12px;font-family:Arial,sans-serif"><div style="max-width:600px;margin:0 auto">
<div style="background:#0a0a0a;padding:22px 28px;border-radius:12px 12px 0 0;color:#22c55e;font-size:22px;font-weight:800;letter-spacing:2px">WHAPPNUS</div>
<div style="background:#fff;padding:32px 28px;color:#1f2937;font-size:15px;line-height:1.6">
<h1 style="font-size:22px;margin:0 0 12px">Recuperar acesso</h1>
<p>Recebemos um pedido para criar uma nova palavra-passe para a tua conta WhappNus.</p>
<p style="margin:24px 0"><a href="{{ .ConfirmationURL }}" style="background:#22c55e;color:#0b0f0c;padding:14px 28px;border-radius:8px;font-weight:700;text-decoration:none">Criar nova palavra-passe</a></p>
<p style="font-size:13px;color:#6b7280">Link alternativo:<br>{{ .ConfirmationURL }}</p>
<p style="font-size:13px;color:#6b7280">Por segurança, o link expira em breve e só pode ser usado uma vez. Nunca partilhes este e-mail. Se não pediste a recuperação, ignora-o — a tua palavra-passe não muda.</p>
<p>Com os melhores cumprimentos,<br><strong>Equipa WhappNus</strong></p></div>
<div style="background:#0a0a0a;padding:18px;border-radius:0 0 12px 12px;color:#9ca3af;font-size:12px;text-align:center">WhappNus — A tua operação, mais inteligente.</div></div></div>
```

## SMTP (opcional, depois de o domínio estar autenticado na Brevo)
Authentication → SMTP Settings: host `smtp-relay.brevo.com`, porta `587`, utilizador e chave SMTP da Brevo (Brevo → SMTP & API), remetente `nao-responder@whappnus.online`, nome `WhappNus`.
