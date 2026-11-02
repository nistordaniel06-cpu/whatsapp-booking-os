import type {SupabaseClient} from "@supabase/supabase-js";
import type {BookResult, BookingRepo, UpcomingBooking} from "./types";
import type {Conversation, ConversationStore} from "./pipeline";
import {summarize} from "../whatsapp/messages";

type Rel<T> = T | T[] | null;
const one = <T>(v: Rel<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v);

function fail(where: string, error: {message: string; code?: string}): never {
  throw new Error(`${where}: ${error.code ?? ""} ${error.message}`.trim());
}

export function supabaseBookingRepo(db: SupabaseClient): BookingRepo {
  return {
    async getCatalog(salonId) {
      const [salon, services, staff, links] = await Promise.all([
        db.from("salons").select("id,name,timezone,address,slot_step_minutes,min_notice_minutes,booking_horizon_days,cancel_notice_minutes").eq("id", salonId).single(),
        db.from("services").select("id,name,duration_minutes,price_ron").eq("salon_id", salonId).eq("active", true).order("sort_order").order("name"),
        db.from("staff").select("id,name").eq("salon_id", salonId).eq("active", true).order("name"),
        db.from("staff_services").select("staff_id,service_id").eq("salon_id", salonId),
      ]);
      if (salon.error) fail("salons", salon.error);
      if (services.error) fail("services", services.error);
      if (staff.error) fail("staff", staff.error);
      if (links.error) fail("staff_services", links.error);
      const s = salon.data;
      return {
        salon: {id: s.id, name: s.name, timezone: s.timezone, address: s.address, slotStepMinutes: s.slot_step_minutes, minNoticeMinutes: s.min_notice_minutes, bookingHorizonDays: s.booking_horizon_days, cancelNoticeMinutes: s.cancel_notice_minutes},
        services: services.data.map(x => ({id: x.id, name: x.name, durationMinutes: x.duration_minutes, priceRon: Number(x.price_ron)})),
        staff: staff.data.map(x => {
          const ids = links.data.filter(l => l.staff_id === x.id).map(l => l.service_id);
          return {id: x.id, name: x.name, serviceIds: ids.length ? ids : null};
        }),
      };
    },

    async getSchedule(salonId, staffIds, from, to) {
      const [hours, off, bookings] = await Promise.all([
        db.from("working_hours").select("staff_id,weekday,starts_local,ends_local").eq("salon_id", salonId).in("staff_id", staffIds),
        db.from("time_off").select("staff_id,starts_at,ends_at").eq("salon_id", salonId).lt("starts_at", to.toISOString()).gt("ends_at", from.toISOString()),
        db.from("bookings").select("staff_id,starts_at,ends_at").eq("salon_id", salonId).in("staff_id", staffIds).in("status", ["confirmed", "pending"])
          .lt("starts_at", to.toISOString()).gt("ends_at", from.toISOString()),
      ]);
      if (hours.error) fail("working_hours", hours.error);
      if (off.error) fail("time_off", off.error);
      if (bookings.error) fail("bookings", bookings.error);
      return {
        hours: hours.data.map(h => ({staffId: h.staff_id, weekday: h.weekday, start: String(h.starts_local).slice(0, 5), end: String(h.ends_local).slice(0, 5)})),
        busy: [
          ...off.data.map(t => ({staffId: t.staff_id as string | null, start: new Date(t.starts_at), end: new Date(t.ends_at)})),
          ...bookings.data.map(b => ({staffId: b.staff_id as string, start: new Date(b.starts_at), end: new Date(b.ends_at)})),
        ],
      };
    },

    async book(i): Promise<BookResult> {
      const {data, error} = await db.rpc("whatsapp_book_slot", {
        p_salon: i.salonId, p_staff: i.staffId, p_service: i.serviceId, p_phone: i.phone, p_name: i.name ?? null, p_start: i.start.toISOString(), p_key: i.key,
      });
      if (error) {
        const known = ["slot_taken", "too_soon", "outside_working_hours", "time_off"] as const;
        const hit = known.find(k => error.message.includes(k));
        if (hit) return {ok: false, reason: hit};
        if (/not_found|invalid|too_far|does_not_offer/.test(error.message)) return {ok: false, reason: "invalid"};
        console.error("[booking] rpc failed", error.code, error.message);
        return {ok: false, reason: "error"};
      }
      const row = (Array.isArray(data) ? data[0] : data) as {id: string; starts_at: string};
      return {ok: true, bookingId: row.id, start: new Date(row.starts_at)};
    },

    async upcoming(salonId, phone, now): Promise<UpcomingBooking[]> {
      const client = await db.from("clients").select("id").eq("salon_id", salonId).eq("phone_e164", phone).maybeSingle();
      if (client.error) fail("clients", client.error);
      if (!client.data) return [];
      const {data, error} = await db.from("bookings").select("id,starts_at,service:services(name),staff:staff(name)")
        .eq("salon_id", salonId).eq("client_id", client.data.id).in("status", ["confirmed", "pending"]).gt("starts_at", now.toISOString()).order("starts_at").limit(10);
      if (error) fail("bookings", error);
      return (data as {id: string; starts_at: string; service: Rel<{name: string}>; staff: Rel<{name: string}>}[]).map(b => ({
        id: b.id, start: new Date(b.starts_at), serviceName: one(b.service)?.name ?? "Serviciu", staffName: one(b.staff)?.name ?? "Specialist",
      }));
    },

    async cancel(salonId, bookingId, phone) {
      const {error} = await db.rpc("whatsapp_cancel_booking", {p_salon: salonId, p_booking: bookingId, p_phone: phone});
      if (!error) return {ok: true};
      if (error.message.includes("too_late_to_cancel")) return {ok: false, reason: "too_late"};
      if (/booking_not_found|booking_not_active/.test(error.message)) return {ok: false, reason: "not_found"};
      console.error("[booking] cancel failed", error.code, error.message);
      return {ok: false, reason: "error"};
    },
  };
}

export function supabaseConversationStore(db: SupabaseClient): ConversationStore {
  return {
    async resolveSalon(phoneNumberId) {
      const {data, error} = await db.from("whatsapp_numbers").select("salon_id").eq("phone_number_id", phoneNumberId).eq("active", true).maybeSingle();
      if (error) fail("whatsapp_numbers", error);
      return data?.salon_id ?? null;
    },

    async recordInbound(salonId, msg): Promise<Conversation | null> {
      const conv = await db.from("conversations")
        .upsert({salon_id: salonId, client_phone: msg.from, profile_name: msg.profileName ?? null, last_inbound_at: new Date(msg.timestamp * 1000).toISOString(), updated_at: new Date().toISOString()}, {onConflict: "salon_id,client_phone"})
        .select("id,state,mode,human_until").single();
      if (conv.error) fail("conversations", conv.error);
      const input = msg.input;
      const body = input.kind === "text" ? input.text : input.kind === "reply" ? (input.title ?? input.id) : `[${input.type}]`;
      const ins = await db.from("messages").insert({salon_id: salonId, conversation_id: conv.data.id, direction: "in", wa_message_id: msg.waMessageId, kind: input.kind, body, payload: input});
      if (ins.error) {
        if (ins.error.code === "23505") return null;
        fail("messages", ins.error);
      }
      return {id: conv.data.id, state: conv.data.state, mode: conv.data.mode, humanUntil: conv.data.human_until ? new Date(conv.data.human_until) : null};
    },

    async saveState(conversationId, state, handoffUntil) {
      const patch: Record<string, unknown> = {state, updated_at: new Date().toISOString()};
      if (handoffUntil) { patch.mode = "human"; patch.human_until = handoffUntil.toISOString(); }
      else { patch.mode = "bot"; patch.human_until = null; }
      const {error} = await db.from("conversations").update(patch).eq("id", conversationId);
      if (error) fail("conversations.update", error);
    },

    async recordOutbound(salonId, conversationId, msg, waMessageId, error) {
      const res = await db.from("messages").insert({salon_id: salonId, conversation_id: conversationId, direction: "out", wa_message_id: waMessageId, kind: msg.kind, body: summarize(msg), payload: msg, status: error ? "failed" : "sent", error: error ?? null});
      if (res.error) console.error("[whatsapp] could not store outbound", res.error.code, res.error.message);
    },

    async recordStatus(update) {
      const {error} = await db.from("messages").update({status: update.status, error: update.error ?? null}).eq("wa_message_id", update.waMessageId);
      if (error) console.error("[whatsapp] could not store status", error.code, error.message);
    },
  };
}
