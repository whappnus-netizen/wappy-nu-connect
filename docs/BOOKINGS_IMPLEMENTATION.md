# WHAPPNUS — Intelligent Bookings V1

## Scope

The first release provides WhatsApp-originated and dashboard-managed bookings for any business that uses time-based availability. Payments, public booking links, automatic WhatsApp reminders, recurring reservations and multi-day inventory are deliberately outside this release.

## Architecture

- Dashboard: authenticated TanStack Start route at `/_authenticated/agendamentos`.
- Server boundary: `src/lib/booking.functions.ts`; every operation validates the active organization and the member's role before using the service-role client.
- Database: additive migrations create organization-scoped booking settings, services, staff, resources, weekly availability, exceptions, bookings and immutable booking events.
- AI Engine: the companion `WhappNus-AI-Engine` change exposes a constrained booking action protocol. It is disabled in AI test mode and requires both organization-level activation and explicit per-agent permissions.
- WhatsApp transport: unchanged. The existing inbound message pipeline already passes organization, contact, conversation and message context to the AI engine.

## Confirmation model

The organization chooses automatic confirmation or human approval. A service may override the organization default. Manual approval creates a temporary pending booking; stale requests are lazily expired before availability checks and new bookings. Expiration produces a booking event and an internal organization notification.

## Safety guarantees

- Every booking and related record carries `organization_id`.
- Composite foreign keys bind contacts, conversations, services, staff and resources to the same organization.
- Browser clients receive read-only table privileges. Mutations use authenticated server functions and service-role-only RPCs.
- Creation is serialized per organization, idempotent, and checks service capacity, staff/resource conflicts and configured opening hours.
- AI cancellation and rescheduling are restricted to the contact attached to the active conversation and require explicit agent and organization permissions.
- No payment is collected or recorded by this release.

## First-release limitations

- Weekly organization opening hours are supported. Staff/resource-specific weekly rules are read by the AI availability engine; advanced exception editing is not yet exposed in the dashboard.
- Dashboard booking creation is a basic operational form, not a full drag-and-drop calendar.
- Internal notifications are created for booking events. WhatsApp reminders are not sent yet; the reminder flags remain disabled until a reliable scheduled sender exists.
- Public booking pages, external calendar synchronization, waitlists, recurring and multi-day reservations are future work.

## Rollout

Apply the migrations in timestamp order before deploying the frontend and AI Engine branches. Then enable bookings for one test organization, configure at least one active service and weekly schedule, enable the desired booking permissions on its AI agent, and validate real WhatsApp create/cancel/reschedule flows before wider activation.
