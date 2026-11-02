import {Outbound, toGraphPayload} from "./messages";

export type Sender = (phoneNumberId: string, to: string, message: Outbound) => Promise<{id: string | null; error?: string}>;

/** WhatsApp Cloud API sender. The access token never leaves the server and is never logged. */
export function cloudApiSender(accessToken: string, graphVersion = "v23.0"): Sender {
  return async (phoneNumberId, to, message) => {
    const res = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: {Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json"},
      body: JSON.stringify(toGraphPayload(to.replace(/^\+/, ""), message)),
    });
    const data = (await res.json().catch(() => ({}))) as {messages?: {id: string}[]; error?: {message?: string; code?: number}};
    if (!res.ok) return {id: null, error: `HTTP ${res.status} ${data.error?.code ?? ""} ${data.error?.message ?? ""}`.trim()};
    return {id: data.messages?.[0]?.id ?? null};
  };
}
