import {describe, it, expect, beforeAll} from "vitest";
import type {PGlite} from "@electric-sql/pglite";
import {freshDb, seedSalon, tomorrowAt, asUser} from "./harness";

let db: PGlite;
let a: {salon: string; staff: string; service: string};
let b: {salon: string; staff: string; service: string};
const ownerA = "00000000-0000-0000-0000-00000000000a";
const ownerB = "00000000-0000-0000-0000-00000000000b";

async function book(start: string, key: string, phone = "+40712345678", s = a) {
  return db.query<{id: string; status: string; ends_at: string}>(
    `select id, status, ends_at::text from whatsapp_book_slot($1,$2,$3,$4,'Ion',$5,$6)`,
    [s.salon, s.staff, s.service, phone, start, key]);
}

beforeAll(async () => {
  db = await freshDb();
  a = await seedSalon(db, "Salon A");
  b = await seedSalon(db, "Salon B");
  await db.query(`insert into auth.users(id) values ($1),($2)`, [ownerA, ownerB]);
  await db.query(`insert into salon_members(salon_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')`, [a.salon, ownerA, b.salon, ownerB]);
}, 60_000);

describe("whatsapp_book_slot", () => {
  it("creates a confirmed booking with the service duration", async () => {
    const start = await tomorrowAt(db, "10:00");
    const r = await book(start, "key-0001-aaaa");
    expect(r.rows[0].status).toBe("confirmed");
    const span = await db.query<{m: number}>(`select extract(epoch from ends_at - starts_at)/60 as m from bookings where id=$1`, [r.rows[0].id]);
    expect(Number(span.rows[0].m)).toBe(30);
  });

  it("is idempotent for the same key", async () => {
    const start = await tomorrowAt(db, "10:00");
    const first = await book(start, "key-0001-aaaa");
    const again = await book(start, "key-0001-aaaa");
    expect(again.rows[0].id).toBe(first.rows[0].id);
  });

  it("rejects an overlapping booking for the same specialist", async () => {
    const start = await tomorrowAt(db, "10:15");
    await expect(book(start, "key-0002-bbbb", "+40799999999")).rejects.toThrow(/slot_taken/);
  });

  it("allows an adjacent slot", async () => {
    const r = await book(await tomorrowAt(db, "10:30"), "key-0003-cccc");
    expect(r.rows[0].status).toBe("confirmed");
  });

  it("rejects slots outside working hours", async () => {
    await expect(book(await tomorrowAt(db, "17:45"), "key-0004-dddd")).rejects.toThrow(/outside_working_hours/);
    await expect(book(await tomorrowAt(db, "08:00"), "key-0005-eeee")).rejects.toThrow(/outside_working_hours/);
  });

  it("rejects time off", async () => {
    const s = await tomorrowAt(db, "15:00");
    await db.query(`insert into time_off(salon_id, staff_id, starts_at, ends_at) values ($1,$2,$3::timestamptz,$3::timestamptz + interval '1 hour')`, [a.salon, a.staff, s]);
    await expect(book(await tomorrowAt(db, "15:30"), "key-0006-ffff")).rejects.toThrow(/time_off/);
  });

  it("rejects invalid phone and cross-salon staff", async () => {
    await expect(book(await tomorrowAt(db, "12:00"), "key-0007-gggg", "0712")).rejects.toThrow(/invalid_phone/);
    await expect(db.query(`select * from whatsapp_book_slot($1,$2,$3,'+40711111111','X',$4,'key-0008-hhhh')`,
      [a.salon, b.staff, a.service, await tomorrowAt(db, "12:00")])).rejects.toThrow(/staff_not_found/);
  });

  // PGlite serialises queries; the guarantee under true concurrency comes from the exclusion constraint itself.
  it("only one of two simultaneous attempts for the same slot succeeds", async () => {
    const start = await tomorrowAt(db, "13:00");
    const results = await Promise.allSettled([book(start, "race-1-xxxxxx", "+40700000001"), book(start, "race-2-xxxxxx", "+40700000002")]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("cancellation", () => {
  it("lets the client cancel only their own booking", async () => {
    const r = await book(await tomorrowAt(db, "16:00"), "key-cxl-0001");
    await expect(db.query(`select * from whatsapp_cancel_booking($1,$2,'+40700000009')`, [a.salon, r.rows[0].id])).rejects.toThrow(/booking_not_found/);
    const c = await db.query<{status: string}>(`select status from whatsapp_cancel_booking($1,$2,'+40712345678')`, [a.salon, r.rows[0].id]);
    expect(c.rows[0].status).toBe("cancelled");
    // the freed slot can be booked again
    expect((await book(await tomorrowAt(db, "16:00"), "key-cxl-0002", "+40700000010")).rows[0].status).toBe("confirmed");
  });
});

describe("tenant isolation (RLS)", () => {
  it("owners only see their own salon", async () => {
    const seen = await asUser(db, ownerA, () => db.query<{id: string}>(`select id from salons`));
    expect(seen.rows.map(r => r.id)).toEqual([a.salon]);
    const bookingsB = await asUser(db, ownerA, () => db.query(`select id from bookings where salon_id=$1`, [b.salon]));
    expect(bookingsB.rows).toHaveLength(0);
  });

  it("authenticated users cannot call the WhatsApp RPC or insert bookings directly", async () => {
    const start = await tomorrowAt(db, "11:00");
    await expect(asUser(db, ownerA, () => book(start, "key-rls-0001"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, ownerA, () => db.query(
      `insert into bookings(salon_id,staff_id,service_id,client_id,starts_at,ends_at) select salon_id,$1,$2,id,$3,$3::timestamptz+interval '30 min' from clients limit 1`,
      [a.staff, a.service, start]))).rejects.toThrow(/row-level security|permission denied/);
  });

  it("dashboard RPC enforces membership", async () => {
    const start = await tomorrowAt(db, "11:00");
    const sql = `select status from dashboard_create_booking($1,$2,'+40722222222','Maria',$3,'dash-key-0001')`;
    await expect(asUser(db, ownerB, () => db.query(sql, [a.staff, a.service, start]))).rejects.toThrow(/forbidden/);
    const ok = await asUser(db, ownerA, () => db.query<{status: string}>(sql, [a.staff, a.service, start]));
    expect(ok.rows[0].status).toBe("confirmed");
  });
});
