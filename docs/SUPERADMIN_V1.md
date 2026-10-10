# Wapnus Super Admin v1

## Estado desta entrega

- Frontend: rota protegida `/superadmin` em `src/routes/superadmin.tsx`, adicionada sem substituir rotas existentes.
- Backend administrativo: Supabase Edge Function `superadmin-api`, com JWT obrigatório, validação do utilizador via Supabase Auth e autorização por `public.superadmin_users`.
- Supabase externo `icqkoafhitudaqylnnfd`: migrações `whappnus_superadmin_v1` e `whappnus_superadmin_v2` aplicadas em 2026-10-10.
- Dados existentes de conversas, mensagens, sessões e logs não foram recriados nem apagados.
- A conta do proprietário ainda precisa de ser autorizada em `public.superadmin_users`; não se deve promover um utilizador automaticamente sem confirmar o UUID correto.

## Módulos presentes no frontend

1. **Visão geral:** organizações, organizações ativas/suspensas, subscrições ativas, pagamentos com falha, números WhatsApp ligados e erros de IA.
2. **Organizações:** pesquisa, criação, atribuição opcional de proprietário por UUID, contagens de equipa/WhatsApp/agentes e alteração do estado administrativo.
3. **Planos:** catálogo em AOA, periodicidade mensal/anual e criação de planos. Planos com preço zero ficam inativos.
4. **Assinaturas:** estado, valor, plano, organização e período atual.
5. **Pagamentos:** estado, fornecedor, referência, valor e data de pagamento.
6. **Saúde operacional:** estado registado das sessões WhatsApp, erros de IA e eventos recentes.
7. **Equipa administrativa:** adicionar/atualizar contas existentes por UUID, funções owner/admin/support/billing e ativação/desativação; só o owner pode alterar membros da equipa.\n8. **Auditoria:** ações privilegiadas registadas no servidor.

## Segurança

- A interface não consulta diretamente todas as organizações nem as tabelas de pagamentos/auditoria.
- Todas as ações administrativas passam pela Edge Function autenticada.
- A Edge Function valida a sessão Supabase e confirma que existe uma linha ativa em `superadmin_users`.
- As tabelas administrativas mantêm RLS ativado; dados de pagamentos, subscrições, auditoria, convites e credenciais não têm acesso direto para `anon`/ `authenticated`.
- A chave `service_role` só é usada na Edge Function; nunca deve ser adicionada ao frontend/Netlify com prefixo `VITE_`.
- Os planos de exemplo têm preço zero e ficam inativos até serem configurados.

## Migrações aplicadas

- `supabase/migrations/20261010_superadmin_v1.sql`: administradores, catálogo de planos, subscrições, transações, auditoria e metadados de convites.
- `supabase/migrations/20261010_superadmin_v2.sql`: estados administrativos de organização e registos de webhooks/e-mail.

## Limites conhecidos — não confundir estado administrativo com bloqueio operacional

A mudança de estado da organização é registada em `organizations.status`. Nesta entrega, **a alteração de estado ainda não desliga uma sessão Baileys ativa nem garante que o motor WhatsApp/IA recuse todo o tráfego dessa organização**. Isso exige uma integração aditiva e validada nos serviços Railway. Não afirmar que suspender/bloquear já corta a sessão até essa integração ser implementada e testada.

O painel mostra o estado de WhatsApp/IA que está guardado na base de dados; não reinicia serviços Railway nem revela segredos de fornecedores.

## Configuração final do proprietário

Depois de confirmar o UUID correto da conta de login do proprietário, executar uma única vez no SQL Editor:

```sql
insert into public.superadmin_users (user_id, role, permissions, is_active)
values ('UUID_CONFIRMADO_DO_PROPRIETARIO'::uuid, 'owner', '{"*": true}'::jsonb, true)
on conflict (user_id) do update
set role = 'owner', permissions = '{"*": true}'::jsonb, is_active = true;
```

Não executar com um UUID de cliente comum. Para outros membros, atribuir apenas as permissões necessárias e não usar `owner`.

## Pagamentos e convites — fase seguinte

As tabelas base para transações, eventos de webhook, convites e logs de e-mail existem. A confirmação de pagamento ainda depende da integração real com o fornecedor: validar assinatura do webhook, deduplicar IDs de evento e atualizar subscrições apenas depois de confirmação válida. O painel não simula pagamentos nem envia e-mails automaticamente.
