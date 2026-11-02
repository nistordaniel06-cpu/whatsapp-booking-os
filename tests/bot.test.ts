import {describe, it, expect, beforeEach} from "vitest";
import {processInbound, type Conversation, type ConversationStore} from "../src/lib/bot/pipeline";
import type {BookingRepo} from "../src/lib/bot/types";
import type {Outbound} from "../src/lib/whatsapp/messages";
import type {InboundMessage} from "../src/lib/whatsapp/webhook";
import type {Sender} from "../src/lib/whatsapp/send";

const SALON = "11111111-1111-1111-1111-111111111111";
const ANDREI = "22222222-2222-2222-2222-222222222222";
const DANIEL = "33333333-3333-3333-3333-333333333333";
const TUNS = "44444444-4444-4444-4444-444444444444";
const PHONE = "+40712345678";
// Monday 2 Nov 2026, 15:20 in Bucharest
const NOW = new Date("2026-11-02T13:20:00Z");

type Bk = {id: string; staffId: string; serviceId: string; phone: string; start: Date; end: Date; status: string; key: string};

function world() {
  const bookings: Bk[] = [];
  const sent: Outbound[] = [];
  const convs = new Map<string, Conversation>();
  const seen = new Set<string>();
  let n = 0;
  const repo: BookingRepo = {
    async getCatalog() {
      return {
        salon: {id: SALON, name: "4MEN", timezone: "Europe/Bucharest", address: "Str. Exemplu 1", phone: "+40 700 000 000", slotStepMinutes: 30, minNoticeMinutes: 60, bookingHorizonDays: 7, cancelNoticeMinutes: 120},
        services: [{id: TUNS, name: "Tuns", durationMinutes: 30, priceRon: 60}],
        staff: [{id: ANDREI, name: "Andrei", serviceIds: null}, {id: DANIEL, name: "Daniel", serviceIds: null}],
      };
    },
    async getSchedule(_s, staffIds, from, to) {
      return {
        hours: staffIds.flatMap(id => [1, 2, 3, 4, 5].map(weekday => ({staffId: id, weekday, start: "10:00", end: "18:00"}))),
        // Same window filter as the Supabase query, so a too-narrow window shows up in tests.
        busy: bookings.filter(b => b.status === "confirmed" && b.start < to && b.end > from).map(b => ({staffId: b.staffId, start: b.start, end: b.end})),
      };
    },
    async book(i) {
      const same = bookings.find(b => b.key === i.key);
      if (same) return {ok: true, bookingId: same.id, start: same.start};
      const end = new Date(i.start.getTime() + 30 * 60000);
      if (bookings.some(b => b.status === "confirmed" && b.staffId === i.staffId && b.start < end && i.start < b.end)) return {ok: false, reason: "slot_taken"};
      const b = {id: `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`, staffId: i.staffId, serviceId: i.serviceId, phone: i.phone, start: i.start, end, status: "confirmed", key: i.key};
      bookings.push(b);
      return {ok: true, bookingId: b.id, start: b.start};
    },
    async upcoming(_s, phone, now) {
      return bookings.filter(b => b.phone === phone && b.status === "confirmed" && b.start > now)
        .map(b => ({id: b.id, start: b.start, serviceName: "Tuns", staffName: b.staffId === ANDREI ? "Andrei" : "Daniel"}));
    },
    async cancel(_s, id, phone) {
      const b = bookings.find(x => x.id === id && x.phone === phone && x.status === "confirmed");
      if (!b) return {ok: false, reason: "not_found"};
      b.status = "cancelled";
      return {ok: true};
    },
  };
  const store: ConversationStore = {
    async resolveSalon(pn) { return pn === "PN1" ? SALON : null; },
    async recordInbound(_s, m) {
      if (seen.has(m.waMessageId)) return null;
      seen.add(m.waMessageId);
      if (!convs.has(m.from)) convs.set(m.from, {id: "c-" + m.from, state: {}, mode: "bot", humanUntil: null});
      return {...convs.get(m.from)!};
    },
    async saveState(id, state, until) {
      const c = [...convs.values()].find(x => x.id === id)!;
      c.state = state; c.mode = until ? "human" : "bot"; c.humanUntil = until ?? null;
    },
    async recordOutbound() {},
    async recordStatus() {},
  };
  let keyN = 0;
  let msgN = 0;
  let send: Sender = async (_pn, _to, m) => { sent.push(m); return {id: "out." + sent.length}; };
  const setSend = (fn: Sender) => { send = fn; };
  async function say(input: InboundMessage["input"], opts: {id?: string; from?: string; now?: Date} = {}) {
    sent.length = 0;
    const msg: InboundMessage = {waMessageId: opts.id ?? `wamid.${++msgN}`, phoneNumberId: "PN1", from: opts.from ?? PHONE, profileName: "Ion Popescu", timestamp: 0, input};
    const r = await processInbound(msg, {store, repo, send, now: opts.now ?? NOW, newKey: () => `key-${++keyN}`});
    return {r, out: [...sent]};
  }
  return {say, bookings, convs, repo, setSend};
}

const reply = (id: string) => ({kind: "reply" as const, id});
const rowsOf = (m: Outbound) => (m.kind === "list" ? m.rows : m.kind === "buttons" ? m.buttons : []);

describe("WhatsApp booking flow", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => { w = world(); });

  it("books a real slot end-to-end and blocks it afterwards", async () => {
    let {out} = await w.say({kind: "text", text: "Salut"});
    expect(out[0]).toMatchObject({kind: "buttons", body: expect.stringContaining("Ion")});

    ({out} = await w.say({kind: "text", text: "vreau o tunsoare"}));
    expect(rowsOf(out[0]).map(r => r.id)).toEqual([`svc:${TUNS}`]);

    ({out} = await w.say(reply(`svc:${TUNS}`)));
    expect(rowsOf(out[0]).map(r => r.title)).toEqual(["Oricine e liber", "Andrei", "Daniel"]);

    ({out} = await w.say(reply(`stf:${TUNS}:${ANDREI}`)));
    const days = rowsOf(out[0]);
    // Today 15:20 + 60 min notice → first slot 16:30, so "Azi" has 16:30, 17:00, 17:30; weekend excluded.
    expect(days[0]).toMatchObject({title: "Azi", description: "3 ore libere"});
    expect(days).toHaveLength(5); // Mon–Fri only: weekend has no working hours

    ({out} = await w.say(reply(days[1].id))); // tomorrow
    const slots = rowsOf(out[0]);
    expect(slots[0].title).toBe("10:00");
    expect(slots.at(-1)!.title).toBe("Mai târziu →"); // 16 slots → paginated

    ({out} = await w.say(reply(slots[0].id)));
    expect(out[0]).toMatchObject({kind: "buttons", body: expect.stringContaining("Andrei")});

    ({out} = await w.say(reply("ok")));
    expect(out[0]).toMatchObject({kind: "text", body: expect.stringContaining("confirmată")});
    expect(w.bookings).toHaveLength(1);
    expect(w.bookings[0].start.toISOString()).toBe("2026-11-03T08:00:00.000Z"); // 10:00 Bucharest

    // Pressing confirm twice does not create a duplicate
    ({out} = await w.say(reply("ok")));
    expect(w.bookings).toHaveLength(1);

    // 10:00 tomorrow is no longer offered for Andrei
    ({out} = await w.say(reply(days[1].id)));
    expect(rowsOf(out[0])[0].title).toBe("10:30");
  });

  it("handles the slot being taken between selection and confirmation", async () => {
    const slotId = `slot:${TUNS}:${ANDREI}:${Math.round(new Date("2026-11-03T08:00:00Z").getTime() / 60000)}`;
    await w.say(reply(slotId));
    await w.say(reply(slotId), {from: "+40799999999"});
    await w.say(reply("ok"), {from: "+40799999999"}); // someone else confirms first
    const {out} = await w.say(reply("ok"));
    expect(out[0]).toMatchObject({kind: "text", body: expect.stringContaining("indisponibilă")});
    expect(rowsOf(out[1])[0].title).toBe("10:30");
    expect(w.bookings).toHaveLength(1);
  });

  it("ignores webhook retries of the same message", async () => {
    expect((await w.say({kind: "text", text: "Salut"}, {id: "wamid.same"})).r).toBe("replied");
    expect((await w.say({kind: "text", text: "Salut"}, {id: "wamid.same"})).r).toBe("duplicate");
  });

  it("ignores unknown business numbers", async () => {
    const r = await processInbound({waMessageId: "x", phoneNumberId: "OTHER", from: PHONE, timestamp: 0, input: {kind: "text", text: "hi"}},
      {store: {resolveSalon: async () => null} as unknown as ConversationStore, repo: {} as BookingRepo, send: async () => ({id: null})});
    expect(r).toBe("unknown_number");
  });

  it("lets the client see and cancel their booking", async () => {
    const slotId = `slot:${TUNS}:${DANIEL}:${Math.round(new Date("2026-11-04T12:00:00Z").getTime() / 60000)}`;
    await w.say(reply(slotId));
    await w.say({kind: "text", text: "da"});
    expect(w.bookings[0].status).toBe("confirmed");

    let {out} = await w.say({kind: "text", text: "as vrea sa anulez"});
    const row = rowsOf(out[0])[0];
    expect(row).toMatchObject({title: expect.stringContaining("14:00"), description: "Tuns · Daniel"});
    ({out} = await w.say(reply(row.id)));
    ({out} = await w.say(reply(rowsOf(out[0])[0].id)));
    expect(out[0].kind === "buttons" && out[0].body).toContain("anulată");
    expect(w.bookings[0].status).toBe("cancelled");
  });

  it("points to the salon phone for a human and keeps the bot active (no staff inbox yet)", async () => {
    const {out} = await w.say({kind: "text", text: "vreau sa vorbesc cu un om"});
    expect(out[0]).toMatchObject({kind: "buttons", body: expect.stringContaining("+40 700 000 000")});
    expect(out[0].kind === "buttons" && out[0].body).not.toMatch(/am anuntat|am anunțat/i);
    expect((await w.say({kind: "text", text: "alo?"})).r).toBe("replied");
  });

  it("does not offer slots already booked on a day far ahead", async () => {
    // Monday 9 Nov, 10:00 local, booked by someone else
    const farSlot = `slot:${TUNS}:${ANDREI}:${Math.round(new Date("2026-11-09T08:00:00Z").getTime() / 60000)}`;
    await w.say(reply(farSlot), {from: "+40711111111"});
    await w.say(reply("ok"), {from: "+40711111111"});
    expect(w.bookings).toHaveLength(1);
    const {out} = await w.say(reply(`day:${TUNS}:${ANDREI}:2026-11-09`));
    expect(rowsOf(out[0])[0].title).toBe("10:30");
  });

  it("paginates services beyond the WhatsApp ten-row limit", async () => {
    const many = Array.from({length: 12}, (_, i) => ({id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`, name: `Serviciu ${i}`, durationMinutes: 30, priceRon: 0}));
    const orig = w.repo.getCatalog;
    w.repo.getCatalog = async (s) => ({...(await orig(s)), services: many});
    let {out} = await w.say({kind: "text", text: "programare"});
    let rows = rowsOf(out[0]);
    expect(rows).toHaveLength(10);
    expect(rows.at(-1)).toMatchObject({id: "svcs:9", title: "Alte servicii →"});
    ({out} = await w.say(reply("svcs:9")));
    rows = rowsOf(out[0]);
    expect(rows.map(r => r.title)).toEqual(["Serviciu 9", "Serviciu 10", "Serviciu 11"]);
  });

  it("retries a failed send once before giving up", async () => {
    let calls = 0;
    w.setSend(async () => (++calls === 1 ? {id: null, error: "HTTP 500"} : {id: "ok"}));
    await w.say({kind: "text", text: "Salut"});
    expect(calls).toBe(2);
  });

  it("never offers a slot the client did not get from the database", async () => {
    // A forged slot id outside working hours is shown for confirmation but the DB layer decides.
    // Here we verify stale/forged ids for unknown staff are rejected before confirmation.
    const {out} = await w.say(reply(`slot:${TUNS}:99999999-9999-9999-9999-999999999999:29000000`));
    expect(out[0]).toMatchObject({kind: "list", body: "Ce serviciu dorești?"});
  });
});
