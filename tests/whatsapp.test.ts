import {describe, it, expect} from "vitest";
import {createHmac} from "node:crypto";
import {parseWebhook, verifyMetaSignature} from "../src/lib/whatsapp/webhook";
import {toGraphPayload} from "../src/lib/whatsapp/messages";

describe("webhook signature", () => {
  const body = Buffer.from(JSON.stringify({hello: "lume ă"}));
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  it("accepts a valid signature", () => expect(verifyMetaSignature(body, sig, "s3cret")).toBe(true));
  it("rejects wrong secret, tampered body or missing header", () => {
    expect(verifyMetaSignature(body, sig, "other")).toBe(false);
    expect(verifyMetaSignature(Buffer.from("{}"), sig, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, sig, "")).toBe(false);
  });
});

describe("parseWebhook", () => {
  const payload = {object: "whatsapp_business_account", entry: [{changes: [{field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: {phone_number_id: "PN1", display_phone_number: "40700000000"},
    contacts: [{wa_id: "40712345678", profile: {name: "Ion Pop"}}],
    messages: [
      {from: "40712345678", id: "wamid.1", timestamp: "1762000000", type: "text", text: {body: "Salut"}},
      {from: "40712345678", id: "wamid.2", timestamp: "1762000001", type: "interactive", interactive: {type: "list_reply", list_reply: {id: "svc:x", title: "Tuns"}}},
      {from: "40712345678", id: "wamid.3", timestamp: "1762000002", type: "image", image: {id: "m"}},
      {bogus: true},
    ],
    statuses: [{id: "wamid.out", status: "delivered", timestamp: "1762000003", recipient_id: "40712345678"}],
  }}]}]};

  it("extracts messages, replies, other types and statuses", () => {
    const r = parseWebhook(payload);
    expect(r.messages).toHaveLength(3);
    expect(r.messages[0]).toMatchObject({from: "+40712345678", phoneNumberId: "PN1", profileName: "Ion Pop", input: {kind: "text", text: "Salut"}});
    expect(r.messages[1].input).toEqual({kind: "reply", id: "svc:x", title: "Tuns"});
    expect(r.messages[2].input).toEqual({kind: "other", type: "image"});
    expect(r.statuses).toEqual([{waMessageId: "wamid.out", status: "delivered", timestamp: 1762000003, error: undefined}]);
  });

  it("never throws on garbage", () => {
    expect(parseWebhook(null)).toEqual({messages: [], statuses: []});
    expect(parseWebhook({entry: [{changes: [{value: {}}]}]})).toEqual({messages: [], statuses: []});
  });
});

describe("Graph payload limits", () => {
  it("trims button titles and list rows to Meta limits", () => {
    const p = toGraphPayload("40712345678", {kind: "list", body: "x", button: "Alege serviciul acum te rog", rows: Array.from({length: 12}, (_, i) => ({id: `r${i}`, title: "Un titlu foarte foarte lung pentru rand", description: "d".repeat(100)}))}) as any;
    const rows = p.interactive.action.sections[0].rows;
    expect(rows).toHaveLength(10);
    expect(rows[0].title.length).toBeLessThanOrEqual(24);
    expect(rows[0].description.length).toBeLessThanOrEqual(72);
    expect(p.interactive.action.button.length).toBeLessThanOrEqual(20);
    const b = toGraphPayload("4071", {kind: "buttons", body: "x", buttons: [1, 2, 3, 4].map(i => ({id: `${i}`, title: "Titlu mult prea lung pentru buton"}))}) as any;
    expect(b.interactive.action.buttons).toHaveLength(3);
    expect(b.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
  });
});
