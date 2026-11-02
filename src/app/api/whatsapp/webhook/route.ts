import {timingSafeEqual} from "node:crypto";
import {NextResponse, type NextRequest} from "next/server";
import {parseWebhook, verifyMetaSignature} from "@/lib/whatsapp/webhook";
import {cloudApiSender} from "@/lib/whatsapp/send";
import {processInbound} from "@/lib/bot/pipeline";
import {supabaseBookingRepo, supabaseConversationStore} from "@/lib/bot/supabase";
import {supabaseService} from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Meta webhook verification handshake. */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && p.get("hub.mode") === "subscribe" && safeEqual(p.get("hub.verify_token") ?? "", expected)) {
    return new NextResponse(p.get("hub.challenge") ?? "", {status: 200, headers: {"Content-Type": "text/plain"}});
  }
  return new NextResponse("Forbidden", {status: 403});
}

export async function POST(req: NextRequest) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!secret || !token) {
    console.error("[whatsapp] webhook called but WHATSAPP_APP_SECRET / WHATSAPP_ACCESS_TOKEN are not configured");
    return new NextResponse("Not configured", {status: 503});
  }
  const raw = Buffer.from(await req.arrayBuffer());
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return new NextResponse("Invalid signature", {status: 401});
  }
  let payload: unknown;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { return new NextResponse("Bad JSON", {status: 400}); }

  const {messages, statuses} = parseWebhook(payload);
  if (messages.length === 0 && statuses.length === 0) return NextResponse.json({ok: true});
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[whatsapp] Supabase server environment not configured");
    return new NextResponse("Not configured", {status: 503});
  }
  const db = supabaseService();
  const store = supabaseConversationStore(db);
  const repo = supabaseBookingRepo(db);
  const send = cloudApiSender(token, process.env.WHATSAPP_GRAPH_VERSION || undefined);

  let failed = false;
  for (const s of statuses) await store.recordStatus(s);
  for (const m of messages) {
    try {
      const r = await processInbound(m, {store, repo, send});
      if (r === "unknown_number") console.warn("[whatsapp] message for an unregistered phone_number_id", m.phoneNumberId);
    } catch (e) {
      failed = true;
      console.error("[whatsapp] processing failed", m.waMessageId, e instanceof Error ? e.message : e);
    }
  }
  // 500 lets Meta retry; inbound messages already stored are de-duplicated by wa_message_id.
  return NextResponse.json({ok: !failed}, {status: failed ? 500 : 200});
}
