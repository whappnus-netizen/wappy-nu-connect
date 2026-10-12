# Kursinha webhook — WhappNus

## Production endpoint

`https://icqkoafhitudaqylnnfd.supabase.co/functions/v1/kursinha-webhook`

Subscribe to the Kursinha events `sale.pending`, `sale.approved`, and `sale.cancelled`. Replace any `webhook.site` URL with this endpoint for production.

## Required secret

The endpoint intentionally requires Kursinha's HMAC signature. Do not commit the secret to GitHub or put it in frontend variables.

1. Generate a long random secret (at least 32 bytes).
2. In the Supabase project `icqkoafhitudaqylnnfd`, add the Edge Function secret `KURSINHA_WEBHOOK_SECRET` with that value.
3. In Kursinha > Configurações > Webhooks, create or edit the webhook and set the exact same value in the **Secret** field.
4. Keep the webhook URL public and HTTPS. Do not use `webhook.site` for production.

If the secret is missing, the endpoint returns HTTP 503 and does not process the sale. An invalid signature returns HTTP 401.

## Confirmed product mappings

| Kursinha product ID | WhappNus plan | Expected price |
| --- | --- | ---: |
| `6aca37f7bad1248c97213091` | `start-monthly` | 10,000 AOA |
| `6aca8c46e62b25eb5a5f9df3` | `pro-monthly` | 25,000 AOA |

The 45,000 AOA product is intentionally unmapped until its real Kursinha product ID and checkout URL are confirmed. Never map it based on price alone.

## Processing rules

- `sale.pending`: record only; never activate a plan.
- `sale.approved`: require a valid signature, known active product ID, exact expected price, and currency `AOA`; activate only after account/organization association is verified.
- `sale.cancelled`: mark a pending sale cancelled. If the sale had already been applied, treat the later cancellation as a refund and cancel only the subscription linked to that sale; preserve access if another valid subscription exists.
- A sale ID is the idempotency key. Duplicate deliveries must not extend the subscription twice.
- Approved sales for a buyer without an associated verified account remain pending association. After sign-up and organization onboarding, the app calls the authenticated `claim_pending_sales` action.
- A successful payment grants 30 days. A purchase during an active paid period switches to the purchased plan immediately and adds 30 days to the current end date. Trial time is not converted into extra paid time.
- A manual/admin block is not automatically removed by a payment.

## Go-live checklist

- [ ] Set `KURSINHA_WEBHOOK_SECRET` in Supabase Edge Function secrets.
- [ ] Set the exact same secret in Kursinha.
- [ ] Configure all three events and the production endpoint above.
- [ ] Make one low-value real payment using a mapped product.
- [ ] Verify a `sale.approved` row in `kursinha_webhook_events` with `processing_status=processed`, one matching row in `kursinha_sales` with `applied_at` set, and one `succeeded` row in `payment_transactions`.
- [ ] Verify a duplicate delivery does not create another subscription or extend the expiry twice.
- [ ] Test pending and cancelled/refund events before opening public sign-up.

The Edge Function uses `verify_jwt=false` because Kursinha is a server-to-server caller. The webhook path must therefore keep HMAC verification enabled; never remove the signature check to make a test pass.
