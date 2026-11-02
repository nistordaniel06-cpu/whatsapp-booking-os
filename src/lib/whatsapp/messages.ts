/** Channel-neutral outbound messages, converted to WhatsApp Cloud API payloads. */
export type Outbound =
  | {kind: "text"; body: string}
  | {kind: "buttons"; body: string; buttons: {id: string; title: string}[]}
  | {kind: "list"; body: string; button: string; rows: {id: string; title: string; description?: string}[]};

const cut = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

/** Applies Meta limits: 3 buttons (20 chars), 10 list rows (title 24, description 72), body 1024/4096. */
export function toGraphPayload(to: string, m: Outbound): Record<string, unknown> {
  const base = {messaging_product: "whatsapp", recipient_type: "individual", to};
  if (m.kind === "text") return {...base, type: "text", text: {body: cut(m.body, 4096), preview_url: false}};
  if (m.kind === "buttons") {
    return {...base, type: "interactive", interactive: {
      type: "button",
      body: {text: cut(m.body, 1024)},
      action: {buttons: m.buttons.slice(0, 3).map(b => ({type: "reply", reply: {id: b.id, title: cut(b.title, 20)}}))},
    }};
  }
  return {...base, type: "interactive", interactive: {
    type: "list",
    body: {text: cut(m.body, 1024)},
    action: {
      button: cut(m.button, 20),
      sections: [{title: "Opțiuni", rows: m.rows.slice(0, 10).map(r => ({id: r.id, title: cut(r.title, 24), ...(r.description ? {description: cut(r.description, 72)} : {})}))}],
    },
  }};
}

/** Text stored in the conversation log for an outbound message. */
export function summarize(m: Outbound) {
  if (m.kind === "text") return m.body;
  const opts = m.kind === "buttons" ? m.buttons.map(b => b.title) : m.rows.map(r => r.title);
  return `${m.body}\n[${opts.join(" | ")}]`;
}
