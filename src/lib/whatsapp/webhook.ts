import {createHmac, timingSafeEqual} from "node:crypto";
import {z} from "zod";

/** Verifies Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifyMetaSignature(rawBody: Buffer, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header || !header.startsWith("sha256=")) return false;
  const received = header.slice(7);
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (!/^[0-9a-f]+$/i.test(received) || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

export type InboundMessage = {
  waMessageId: string;
  phoneNumberId: string;
  /** E.164 with leading + */
  from: string;
  profileName?: string;
  timestamp: number;
  input: {kind: "text"; text: string} | {kind: "reply"; id: string; title?: string} | {kind: "other"; type: string};
};

export type StatusUpdate = {waMessageId: string; status: string; timestamp: number; error?: string};

const messageSchema = z.object({
  from: z.string().regex(/^\d{6,15}$/),
  id: z.string().min(1),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({body: z.string()}).optional(),
  interactive: z.object({
    type: z.string(),
    button_reply: z.object({id: z.string(), title: z.string().optional()}).optional(),
    list_reply: z.object({id: z.string(), title: z.string().optional()}).optional(),
  }).optional(),
  button: z.object({payload: z.string().optional(), text: z.string().optional()}).optional(),
});

const valueSchema = z.object({
  metadata: z.object({phone_number_id: z.string()}),
  contacts: z.array(z.object({wa_id: z.string().optional(), profile: z.object({name: z.string().optional()}).optional()})).optional(),
  messages: z.array(z.unknown()).optional(),
  statuses: z.array(z.object({
    id: z.string(), status: z.string(), timestamp: z.string(),
    errors: z.array(z.object({title: z.string().optional(), code: z.number().optional()})).optional(),
  }).passthrough()).optional(),
});

/** Extracts messages and delivery statuses; malformed entries are skipped, never thrown. */
export function parseWebhook(payload: unknown): {messages: InboundMessage[]; statuses: StatusUpdate[]} {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const entries = (payload as {entry?: unknown[]})?.entry;
  if (!Array.isArray(entries)) return {messages, statuses};
  for (const entry of entries) {
    const changes = (entry as {changes?: unknown[]})?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const c = change as {field?: string; value?: unknown};
      if (c.field && c.field !== "messages") continue;
      const v = valueSchema.safeParse(c.value);
      if (!v.success) continue;
      const phoneNumberId = v.data.metadata.phone_number_id;
      for (const raw of v.data.messages ?? []) {
        const m = messageSchema.safeParse(raw);
        if (!m.success) continue;
        const profileName = v.data.contacts?.find(x => x.wa_id === m.data.from)?.profile?.name ?? v.data.contacts?.[0]?.profile?.name;
        let input: InboundMessage["input"];
        const reply = m.data.interactive?.button_reply ?? m.data.interactive?.list_reply;
        if (m.data.type === "text" && m.data.text) input = {kind: "text", text: m.data.text.body};
        else if (m.data.type === "interactive" && reply) input = {kind: "reply", id: reply.id, title: reply.title};
        else if (m.data.type === "button" && m.data.button?.payload) input = {kind: "reply", id: m.data.button.payload, title: m.data.button.text};
        else input = {kind: "other", type: m.data.type};
        messages.push({waMessageId: m.data.id, phoneNumberId, from: "+" + m.data.from, profileName, timestamp: Number(m.data.timestamp), input});
      }
      for (const s of v.data.statuses ?? []) {
        statuses.push({waMessageId: s.id, status: s.status, timestamp: Number(s.timestamp), error: s.errors?.map(e => `${e.code ?? ""} ${e.title ?? ""}`.trim()).join("; ") || undefined});
      }
    }
  }
  return {messages, statuses};
}
