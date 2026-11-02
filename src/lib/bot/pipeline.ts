import {randomUUID} from "node:crypto";
import {handleMessage} from "./engine";
import type {BookingRepo} from "./types";
import type {InboundMessage, StatusUpdate} from "../whatsapp/webhook";
import type {Outbound} from "../whatsapp/messages";
import type {Sender} from "../whatsapp/send";

export type Conversation = {id: string; state: unknown; mode: "bot" | "human"; humanUntil: Date | null};

/** Conversation/message persistence used by the webhook. */
export interface ConversationStore {
  resolveSalon(phoneNumberId: string): Promise<string | null>;
  /** Returns null when this WhatsApp message id was already processed (webhook retry). */
  recordInbound(salonId: string, msg: InboundMessage): Promise<Conversation | null>;
  saveState(conversationId: string, state: unknown, handoffUntil?: Date): Promise<void>;
  recordOutbound(salonId: string, conversationId: string, msg: Outbound, waMessageId: string | null, error?: string): Promise<void>;
  recordStatus(update: StatusUpdate): Promise<void>;
}

export const HUMAN_MODE_HOURS = 12;

export type ProcessResult = "unknown_number" | "duplicate" | "human_mode" | "replied";

export async function processInbound(
  msg: InboundMessage,
  deps: {store: ConversationStore; repo: BookingRepo; send: Sender; now?: Date; newKey?: () => string},
): Promise<ProcessResult> {
  const now = deps.now ?? new Date();
  const salonId = await deps.store.resolveSalon(msg.phoneNumberId);
  if (!salonId) return "unknown_number";
  const conv = await deps.store.recordInbound(salonId, msg);
  if (!conv) return "duplicate";
  if (conv.mode === "human" && conv.humanUntil && conv.humanUntil > now) return "human_mode";

  let result: Awaited<ReturnType<typeof handleMessage>>;
  try {
    result = await handleMessage({
      salonId, phone: msg.from, profileName: msg.profileName, now, state: conv.state, input: msg.input,
      newKey: deps.newKey ?? (() => `wa:${randomUUID()}`),
    }, deps.repo);
  } catch (e) {
    // The inbound message is already stored (and de-duplicated), so a Meta retry would be ignored:
    // answer the client instead of failing silently, and keep their current state.
    console.error("[bot] handler failed", e instanceof Error ? e.message : e);
    result = {state: conv.state as never, replies: [{kind: "text", body: "Ne pare rău, a apărut o eroare tehnică. Te rog să încerci din nou peste câteva minute."}]};
  }

  await deps.store.saveState(conv.id, result.state, result.handoff ? new Date(now.getTime() + HUMAN_MODE_HOURS * 3600000) : undefined);
  for (const reply of result.replies) {
    // One immediate retry covers transient network/Graph errors. A durable outbox with scheduled
    // retries arrives with the notification job queue (V7).
    let sent = await trySend(deps.send, msg.phoneNumberId, msg.from, reply);
    if (sent.error) sent = await trySend(deps.send, msg.phoneNumberId, msg.from, reply);
    await deps.store.recordOutbound(salonId, conv.id, reply, sent.id, sent.error);
    if (sent.error) break; // keep order: don't send later messages if an earlier one failed
  }
  return "replied";
}

async function trySend(send: Sender, phoneNumberId: string, to: string, reply: Outbound): Promise<{id: string | null; error?: string}> {
  try { return await send(phoneNumberId, to, reply); }
  catch (e) { return {id: null, error: e instanceof Error ? e.message : "send failed"}; }
}
