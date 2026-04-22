import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createServerClient } from "@supabase/ssr";
import Stripe from "stripe";

// Supabase service client (bypasses RLS — webhook runs server-side only)
function serviceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } },
  );
}

async function setPlan(
  userId: string,
  plan: string,
  subscriptionId: string,
  expiresAt: Date | null,
) {
  const db = serviceClient();
  await db
    .from("profiles")
    .update({
      plan,
      stripe_subscription_id: subscriptionId,
      plan_expires_at: expiresAt?.toISOString() ?? null,
    })
    .eq("user_id", userId);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json(
      { error: "Missing signature or secret" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Webhook signature failed";
    console.error("[webhook] signature error:", msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    switch (event.type) {
      // ── Payment succeeded → activate plan ─────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id;
        const plan = session.metadata?.plan;
        const subscriptionId = session.subscription as string;
        if (userId && plan && subscriptionId) {
          await setPlan(userId, plan, subscriptionId, null);
          console.log(`[webhook] activated plan=${plan} for user=${userId}`);
        }
        break;
      }

      // ── Subscription renewed ───────────────────────────────────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = (invoice as { subscription?: string }).subscription;
        if (!subId) break;

        const subscription = await stripe.subscriptions.retrieve(subId);
        const userId = subscription.metadata?.supabase_user_id;
        const plan = subscription.metadata?.plan;
        // current_period_end is a Unix timestamp on the Subscription object
        const rawEnd = (
          subscription as unknown as { current_period_end?: number }
        ).current_period_end;
        const periodEnd = rawEnd ? new Date(rawEnd * 1000) : null;

        if (userId && plan) {
          await setPlan(userId, plan, subId, periodEnd);
        }
        break;
      }

      // ── Subscription cancelled / payment failed → downgrade ────────
      case "customer.subscription.deleted":
      case "invoice.payment_failed": {
        let subId: string | undefined;
        let userId: string | undefined;

        if (event.type === "customer.subscription.deleted") {
          const sub = event.data.object as Stripe.Subscription;
          subId = sub.id;
          userId = sub.metadata?.supabase_user_id;
        } else {
          const invoice = event.data.object as Stripe.Invoice;
          subId = (invoice as { subscription?: string }).subscription;
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId);
            userId = sub.metadata?.supabase_user_id;
          }
        }

        if (userId) {
          const db = serviceClient();
          await db
            .from("profiles")
            .update({
              plan: "free",
              stripe_subscription_id: null,
              plan_expires_at: null,
            })
            .eq("user_id", userId);
          console.log(`[webhook] downgraded to free for user=${userId}`);
        }
        break;
      }

      default:
        // Unhandled event type — ignore
        break;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Handler error";
    console.error("[webhook] handler error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
