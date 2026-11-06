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
| `6aca37f7bad1248c97213091` | `start-monthly` | 5,000 AOA |
| `6aca8c46e62b25eb5a5f9df3` | `pro-monthly` | 10,000 AOA |
| `6acc80e79db7fbd07069b6e0` | `premium-monthly` | 20,000 AOA |

All three product IDs remain unchanged; the expected prices were updated to match the seller's current Kursinha checkout prices. The database catalog and webhook validation amounts must remain synchronized.

## Processing rules

- `sale.pending`: record only; never activate a plan.
- `sale.approved`: require a valid signature, known active product ID, exact expected price, and currency `AOA`; activate only after account/organization association is verified.
- `sale.cancelled`: mark a pending sale cancelled. If the sale had already been applied, treat the later cancellation as a refund and cancel only the subscription linked to that sale; preserve access if another valid subscription exists.
- A sale ID is the idempotency key. Duplicate deliveries must not extend the subscription twice.
- Approved sales for a buyer without an associated verified account remain pending association. The paid-first journey is: select one of the three plans → pay on the matching Kursinha product checkout → return to WHAPPNUS → create account and confirm the same e-mail → create organization → claim exactly one approved sale matching that e-mail, selected plan and current expected amount → enter the dashboard.
- The authenticated `claim_pending_sales` action requires the selected plan code and refuses ambiguous/multiple matching purchases; it never claims every approved sale for an e-mail.
- Paid-plan intent is stored in Supabase Auth user metadata. The organization trial trigger skips the automatic free trial for these paid-intent accounts; free signups without a selected paid plan retain the seven-day trial.
- A successful payment grants 30 days. A purchase during an active paid period switches to the purchased plan immediately and adds 30 days to the current end date. Trial time is not converted into extra paid time.
- On activation, the RPC also initializes or resets `ai_credit_accounts` to the selected plan's `ai_messages_monthly` allowance. Paid-first organizations do not depend on the free-trial trigger to receive their AI message quota.
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
