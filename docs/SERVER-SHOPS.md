# Server stores and Stripe Connect

Server shops sell USD digital roles/perks and seller-fulfilled physical products. Each server owner completes **Server Settings → Server Store → Set Up Seller Payouts**. Voxora uses Stripe Connect Express with direct charges to that owner's connected account. The default platform fee is **7.5% of item subtotal**, excluding shipping. The platform owner can set **5–10%** in Admin → Plus → Server Shop Revenue (or Server Shops). Stripe processing fees are separate and depend on the connected account's configuration.

## Configure the backend securely

Set these in the hosting service's private environment configuration:

- `VOXORA_PUBLIC_URL`: the canonical HTTPS origin.
- `VOXORA_STRIPE_SECRET_KEY`: the platform's Stripe secret key, with Connect access.
- `VOXORA_STRIPE_CONNECT_WEBHOOK_SECRET`: signing secret for the connected-account webhook endpoint `/api/shop/stripe/webhook`.

Configure connected-account events for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` and `charge.refunded`. Keep test and live modes separate. The subscription endpoint `/api/billing/stripe/webhook` has its own `VOXORA_STRIPE_WEBHOOK_SECRET` and is separate from the Connect webhook.

For Max subscriptions, run `npm run billing:setup -- --max` with the key provided securely to that process. It creates/reuses a Max product with exactly **2499 cents monthly** and **14999 cents yearly**, never charges a customer, and prints only non-secret price IDs. Configure `VOXORA_STRIPE_MAX_MONTHLY_PRICE_ID` and `VOXORA_STRIPE_MAX_YEARLY_PRICE_ID` alongside the existing Plus prices. New credentials and live catalog changes are not included in the source release.

## Purchases and fulfillment

Publish products with Manage Server Store. Only the current server owner can onboard payouts. Digital products may grant an optional role, private instructions, or both. Staff roles cannot be sold. Physical products specify shipping destinations, a fixed shipping amount and stock; the seller updates fulfillment/tracking in Your Purchases & Sales.

Checkout freezes product/price/fee/seller metadata and uses an idempotent request identifier. Stock is reserved while payment is pending. Local checkout timeout does not release stock until Stripe confirms expiry, preventing late payment from overselling reserved inventory. Keep the webhook healthy to release expired reservations.

A signed event alone does not fulfill an order: Voxora fetches the canonical Checkout Session and PaymentIntent in the original connected account and validates mode, metadata, items, totals and application fee. Role/member/ownership changes can place a paid order into seller review. Duplicate events do not duplicate grants. Full refunds remove a newly granted role only when no later assignment revision intervened; otherwise staff review is required. Refunds and disputes are managed by the seller/platform through Stripe, not by a new Voxora refund button.

Private digital instructions and shipping/customer details appear only in order receipts for the buyer and original seller. Product publication does not expose paid instructions in the storefront. Level 4 servers can highlight three products; level 5 can highlight ten.

## Validation and boundaries

Tests use an isolated fake Stripe provider and signed fixture events. They cover wrong fees/accounts, replay, stock contention, refunds, fulfillment safety and order privacy. No real sale, connected-account onboarding or payout is exercised by those tests. Before enabling a live shop, configure the actual platform account, webhook and seller verification. The Android Play build does not launch digital Stripe checkout; desktop/web digital checkout and physical-goods checkout are available once configured.
