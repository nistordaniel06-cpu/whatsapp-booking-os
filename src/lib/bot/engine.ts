import {computeSlots, uniqueByTime, type Slot} from "../availability";
import {addDays, dayLabelRo, localParts} from "../time";
import type {Outbound} from "../whatsapp/messages";
import type {BookingRepo, SalonInfo, ServiceInfo, StaffInfo} from "./types";

/**
 * Deterministic WhatsApp booking flow (V5). Every option shown comes from the database;
 * every booking is validated again by the database. The AI receptionist (V6) will sit in front
 * of this engine and call the same repo functions — it never writes bookings itself.
 *
 * Reply ids carry their full context (service, specialist, day), so the flow keeps working even
 * if a client taps an older message. Only the final confirmation relies on stored state.
 */
export type BotState =
  | {step: "idle"}
  | {step: "confirm"; serviceId: string; staffId: string; start: string; key: string}
  | {step: "cancel_confirm"; bookingId: string};

export type BotInput = {kind: "text"; text: string} | {kind: "reply"; id: string; title?: string} | {kind: "other"; type?: string};

export type BotContext = {
  salonId: string;
  phone: string;
  profileName?: string;
  now: Date;
  state: unknown;
  input: BotInput;
  newKey: () => string;
};

export type BotResult = {state: BotState; replies: Outbound[]; handoff?: boolean};

const ANY = "any";
const PAGE = 9;
const MAX_DAYS = 14;

export function parseState(raw: unknown): BotState {
  const s = raw as Partial<BotState> | null;
  if (s && s.step === "confirm" && typeof s.serviceId === "string" && typeof s.staffId === "string" && typeof s.start === "string" && typeof s.key === "string") return s as BotState;
  if (s && s.step === "cancel_confirm" && typeof s.bookingId === "string") return s as BotState;
  return {step: "idle"};
}

export function normalizeText(t: string) {
  return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

const UUID = "[0-9a-f-]{36}";
const RE = {
  svc: new RegExp(`^svc:(${UUID})$`),
  stf: new RegExp(`^stf:(${UUID}):(${UUID}|any)$`),
  day: new RegExp(`^day:(${UUID}):(${UUID}|any):(\\d{4}-\\d{2}-\\d{2})$`),
  more: new RegExp(`^more:(${UUID}):(${UUID}|any):(\\d{4}-\\d{2}-\\d{2}):(\\d+)$`),
  slot: new RegExp(`^slot:(${UUID}):(${UUID}):(\\d+)$`),
  cxl: new RegExp(`^cxl:(${UUID})$`),
  cxlok: new RegExp(`^cxlok:(${UUID})$`),
};

export async function handleMessage(ctx: BotContext, repo: BookingRepo): Promise<BotResult> {
  const state = parseState(ctx.state);
  const cat = await repo.getCatalog(ctx.salonId);
  const flow = new Flow(ctx, repo, cat.salon, cat.services, cat.staff);
  const input = ctx.input;

  if (input.kind === "reply") {
    const id = input.id;
    let m: RegExpMatchArray | null;
    if (id === "menu:book") return flow.services();
    if (id === "menu:mine") return flow.mine();
    if (id === "menu:human") return flow.handoff();
    if (id === "menu") return flow.menu();
    if ((m = id.match(RE.svc))) return flow.staffFor(m[1]);
    if ((m = id.match(RE.stf))) return flow.days(m[1], m[2]);
    if ((m = id.match(RE.day))) return flow.slots(m[1], m[2], m[3], 0);
    if ((m = id.match(RE.more))) return flow.slots(m[1], m[2], m[3], Number(m[4]));
    if ((m = id.match(RE.slot))) return flow.confirmPrompt(m[1], m[2], new Date(Number(m[3]) * 60000));
    if (id === "ok") return state.step === "confirm" ? flow.book(state) : flow.menu("Sesiunea a expirat. Te rog să reîncepi.");
    if (id === "no") return flow.menu("Am renunțat la programare. Altceva?");
    if ((m = id.match(RE.cxl))) return flow.cancelPrompt(m[1]);
    if ((m = id.match(RE.cxlok))) return flow.cancel(m[1]);
    return flow.menu();
  }

  if (input.kind === "other") {
    return flow.menu("Momentan pot citi doar mesaje text și butoane. 🙏");
  }

  const t = normalizeText(input.text);
  if (state.step === "confirm" && /^(da|ok|confirm|confirma|sigur|bine)\b/.test(t)) return flow.book(state);
  if (state.step === "confirm" && /^(nu|renunt|stop)\b/.test(t)) return flow.menu("Am renunțat la programare. Altceva?");
  if (state.step === "cancel_confirm" && /^(da|ok|sigur)\b/.test(t)) return flow.cancel(state.bookingId);
  if (/\b(om|operator|uman|persoana|coleg|receptie|sunati|suna-ma)\b/.test(t)) return flow.handoff();
  if (/\b(anul\w*|reprogram\w*|programaril?e? mele|programarea mea)\b/.test(t)) return flow.mine();
  if (/\b(program\w*|rezerv\w*|tuns\w*|tunde\w*|frizur\w*|barb\w*|liber\w*|loc|ora|ore)\b/.test(t)) return flow.services();
  if (/\b(adres\w*|unde|locatie|program de lucru|orar)\b/.test(t)) return flow.info();
  return flow.menu();
}

class Flow {
  private today: string;
  constructor(private ctx: BotContext, private repo: BookingRepo, private salon: SalonInfo, private services_: ServiceInfo[], private staff: StaffInfo[]) {
    this.today = localParts(ctx.now, salon.timezone).date;
  }

  private idle(replies: Outbound[], extra: Partial<BotResult> = {}): BotResult {
    return {state: {step: "idle"}, replies, ...extra};
  }

  menu(intro?: string): BotResult {
    const hello = intro ?? `Salut${this.ctx.profileName ? `, ${this.ctx.profileName.split(" ")[0]}` : ""}! 👋 Sunt asistentul de programări ${this.salon.name}. Cu ce te pot ajuta?`;
    return this.idle([{kind: "buttons", body: hello, buttons: [
      {id: "menu:book", title: "📅 Programare nouă"},
      {id: "menu:mine", title: "🗂 Programările mele"},
      {id: "menu:human", title: "💬 Vorbește cu noi"},
    ]}]);
  }

  info(): BotResult {
    const lines = [`📍 ${this.salon.name}`];
    if (this.salon.address) lines.push(this.salon.address);
    lines.push("Vrei să faci o programare?");
    return this.idle([{kind: "buttons", body: lines.join("\n"), buttons: [{id: "menu:book", title: "📅 Programare nouă"}, {id: "menu:human", title: "💬 Vorbește cu noi"}]}]);
  }

  handoff(): BotResult {
    return this.idle([{kind: "text", body: "Am anunțat echipa salonului. Un coleg îți va răspunde aici cât de curând. 🙏"}], {handoff: true});
  }

  private service(id: string) { return this.services_.find(s => s.id === id); }
  private staffName(id: string) { return this.staff.find(s => s.id === id)?.name ?? "specialist"; }
  private eligible(serviceId: string, staffId: string) {
    const all = this.staff.filter(s => s.serviceIds === null || s.serviceIds.includes(serviceId));
    return staffId === ANY ? all : all.filter(s => s.id === staffId);
  }
  private price(s: ServiceInfo) { return s.priceRon > 0 ? ` · ${s.priceRon.toLocaleString("ro-RO")} lei` : ""; }

  services(): BotResult {
    if (this.services_.length === 0) return this.handoff();
    return this.idle([{kind: "list", body: "Ce serviciu dorești?", button: "Alege serviciul",
      rows: this.services_.slice(0, 10).map(s => ({id: `svc:${s.id}`, title: s.name, description: `${s.durationMinutes} min${this.price(s)}`}))}]);
  }

  async staffFor(serviceId: string): Promise<BotResult> {
    const svc = this.service(serviceId);
    if (!svc) return this.services();
    const people = this.eligible(serviceId, ANY);
    if (people.length === 0) return this.menu(`Momentan nu avem specialiști disponibili pentru ${svc.name}.`);
    if (people.length === 1) return this.days(serviceId, people[0].id);
    return this.idle([{kind: "list", body: `${svc.name} — la ce specialist dorești?`, button: "Alege specialistul",
      rows: [{id: `stf:${serviceId}:${ANY}`, title: "Oricine e liber", description: "Cea mai rapidă variantă"},
        ...people.slice(0, 9).map(p => ({id: `stf:${serviceId}:${p.id}`, title: p.name}))]}]);
  }

  private async available(serviceId: string, staffId: string, days: string[]): Promise<Slot[]> {
    const svc = this.service(serviceId);
    const people = this.eligible(serviceId, staffId);
    if (!svc || people.length === 0 || days.length === 0) return [];
    const ids = people.map(p => p.id);
    const from = new Date(this.ctx.now.getTime() - 86400000);
    const to = new Date(this.ctx.now.getTime() + (days.length + 2) * 86400000);
    const {hours, busy} = await this.repo.getSchedule(this.salon.id, ids, from, to);
    const slots = computeSlots({
      tz: this.salon.timezone, days, durationMinutes: svc.durationMinutes, stepMinutes: this.salon.slotStepMinutes,
      earliest: new Date(this.ctx.now.getTime() + this.salon.minNoticeMinutes * 60000), staffIds: ids, hours, busy,
    });
    return staffId === ANY ? uniqueByTime(slots) : slots;
  }

  private horizon() {
    const n = Math.min(this.salon.bookingHorizonDays, MAX_DAYS);
    return Array.from({length: n}, (_, i) => addDays(this.today, i));
  }

  async days(serviceId: string, staffId: string): Promise<BotResult> {
    const svc = this.service(serviceId);
    if (!svc) return this.services();
    const slots = await this.available(serviceId, staffId, this.horizon());
    const counts = new Map<string, number>();
    for (const s of slots) counts.set(s.date, (counts.get(s.date) ?? 0) + 1);
    const who = staffId === ANY ? "" : ` la ${this.staffName(staffId)}`;
    if (counts.size === 0) {
      return this.idle([{kind: "buttons", body: `Nu mai sunt locuri libere pentru ${svc.name}${who} în următoarele ${this.horizon().length} zile.`,
        buttons: [{id: `svc:${serviceId}`, title: "Alt specialist"}, {id: "menu:human", title: "💬 Vorbește cu noi"}]}]);
    }
    const rows = [...counts.entries()].slice(0, 10).map(([date, n]) => ({
      id: `day:${serviceId}:${staffId}:${date}`, title: dayLabelRo(date, this.today), description: `${n} ${n === 1 ? "oră liberă" : "ore libere"}`,
    }));
    return this.idle([{kind: "list", body: `${svc.name}${who}. Ce zi preferi?`, button: "Alege ziua", rows}]);
  }

  async slots(serviceId: string, staffId: string, date: string, offset: number): Promise<BotResult> {
    const svc = this.service(serviceId);
    if (!svc) return this.services();
    const all = await this.available(serviceId, staffId, [date]);
    if (all.length === 0) return this.days(serviceId, staffId);
    const page = all.slice(offset, offset + PAGE);
    const rows: {id: string; title: string; description?: string}[] = page.map(s => ({
      id: `slot:${serviceId}:${s.staffId}:${Math.round(s.start.getTime() / 60000)}`,
      title: s.time,
      description: staffId === ANY ? this.staffName(s.staffId) : undefined,
    }));
    if (offset + PAGE < all.length) rows.push({id: `more:${serviceId}:${staffId}:${date}:${offset + PAGE}`, title: "Mai târziu →", description: `încă ${all.length - offset - PAGE} ore`});
    return this.idle([{kind: "list", body: `${dayLabelRo(date, this.today)} — orele disponibile:`, button: "Alege ora", rows}]);
  }

  confirmPrompt(serviceId: string, staffId: string, start: Date): BotResult {
    const svc = this.service(serviceId);
    if (!svc || !this.staff.some(s => s.id === staffId)) return this.services();
    const l = localParts(start, this.salon.timezone);
    return {
      state: {step: "confirm", serviceId, staffId, start: start.toISOString(), key: this.ctx.newKey()},
      replies: [{kind: "buttons", body: `Confirmi programarea?\n\n✂️ ${svc.name} (${svc.durationMinutes} min)\n👤 ${this.staffName(staffId)}\n📅 ${dayLabelRo(l.date, this.today)} la ${l.time}${svc.priceRon > 0 ? `\n💰 ${svc.priceRon.toLocaleString("ro-RO")} lei` : ""}`,
        buttons: [{id: "ok", title: "✅ Confirm"}, {id: "no", title: "Renunț"}]}],
    };
  }

  async book(s: Extract<BotState, {step: "confirm"}>): Promise<BotResult> {
    const start = new Date(s.start);
    const res = await this.repo.book({salonId: this.salon.id, staffId: s.staffId, serviceId: s.serviceId, phone: this.ctx.phone, name: this.ctx.profileName, start, key: s.key});
    const svc = this.service(s.serviceId);
    const l = localParts(start, this.salon.timezone);
    if (res.ok) {
      return this.idle([{kind: "text", body: `✅ Programarea este confirmată!\n\n✂️ ${svc?.name ?? "Serviciu"}\n👤 ${this.staffName(s.staffId)}\n📅 ${dayLabelRo(l.date, this.today)} la ${l.time}${this.salon.address ? `\n📍 ${this.salon.address}` : ""}\n\nDacă nu mai poți ajunge, scrie „anulare”.`}]);
    }
    if (res.reason === "slot_taken" || res.reason === "too_soon" || res.reason === "outside_working_hours" || res.reason === "time_off") {
      const again = await this.slots(s.serviceId, s.staffId, l.date, 0);
      return {...again, replies: [{kind: "text", body: "Ne pare rău, ora aleasă tocmai a devenit indisponibilă. Iată ce mai este liber:"}, ...again.replies]};
    }
    return this.menu("Nu am putut salva programarea din cauza unei erori tehnice. Te rog să încerci din nou sau să vorbești cu noi.");
  }

  async mine(): Promise<BotResult> {
    const list = await this.repo.upcoming(this.salon.id, this.ctx.phone, this.ctx.now);
    if (list.length === 0) {
      return this.idle([{kind: "buttons", body: "Nu ai programări viitoare la noi.", buttons: [{id: "menu:book", title: "📅 Programare nouă"}, {id: "menu:human", title: "💬 Vorbește cu noi"}]}]);
    }
    return this.idle([{kind: "list", body: "Programările tale viitoare. Alege una dacă vrei s-o anulezi:", button: "Programări",
      rows: list.slice(0, 10).map(b => {
        const l = localParts(b.start, this.salon.timezone);
        return {id: `cxl:${b.id}`, title: `${dayLabelRo(l.date, this.today)} ${l.time}`, description: `${b.serviceName} · ${b.staffName}`};
      })}]);
  }

  async cancelPrompt(bookingId: string): Promise<BotResult> {
    const b = (await this.repo.upcoming(this.salon.id, this.ctx.phone, this.ctx.now)).find(x => x.id === bookingId);
    if (!b) return this.mine();
    const l = localParts(b.start, this.salon.timezone);
    return {state: {step: "cancel_confirm", bookingId},
      replies: [{kind: "buttons", body: `Anulezi programarea ${b.serviceName} cu ${b.staffName}, ${dayLabelRo(l.date, this.today)} la ${l.time}?`,
        buttons: [{id: `cxlok:${bookingId}`, title: "Da, anulează"}, {id: "menu", title: "Înapoi"}]}]};
  }

  async cancel(bookingId: string): Promise<BotResult> {
    const r = await this.repo.cancel(this.salon.id, bookingId, this.ctx.phone);
    if (r.ok) return this.idle([{kind: "buttons", body: "Programarea a fost anulată. Vrei să alegi altă oră?", buttons: [{id: "menu:book", title: "📅 Programare nouă"}, {id: "menu", title: "Nu, mulțumesc"}]}]);
    if (r.reason === "too_late") {
      const h = Math.round(this.salon.cancelNoticeMinutes / 60);
      return this.idle([{kind: "buttons", body: `Programarea nu mai poate fi anulată online cu mai puțin de ${h} ${h === 1 ? "oră" : "ore"} înainte.`, buttons: [{id: "menu:human", title: "💬 Vorbește cu noi"}]}]);
    }
    if (r.reason === "not_found") return this.mine();
    return this.menu("Nu am putut anula din cauza unei erori tehnice. Te rog să încerci din nou.");
  }
}
