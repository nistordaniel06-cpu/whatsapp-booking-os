import type {Busy, WorkingHours} from "../availability";

export type SalonInfo = {
  id: string;
  name: string;
  timezone: string;
  address: string | null;
  slotStepMinutes: number;
  minNoticeMinutes: number;
  bookingHorizonDays: number;
  cancelNoticeMinutes: number;
};
export type ServiceInfo = {id: string; name: string; durationMinutes: number; priceRon: number};
export type StaffInfo = {id: string; name: string; serviceIds: string[] | null /* null = all services */};

export type BookResult =
  | {ok: true; bookingId: string; start: Date}
  | {ok: false; reason: "slot_taken" | "too_soon" | "outside_working_hours" | "time_off" | "invalid" | "error"};

export type UpcomingBooking = {id: string; start: Date; serviceName: string; staffName: string};

/** Booking data access used by the bot. Implemented with Supabase (service role) in production. */
export interface BookingRepo {
  getCatalog(salonId: string): Promise<{salon: SalonInfo; services: ServiceInfo[]; staff: StaffInfo[]}>;
  getSchedule(salonId: string, staffIds: string[], from: Date, to: Date): Promise<{hours: WorkingHours[]; busy: Busy[]}>;
  book(input: {salonId: string; staffId: string; serviceId: string; phone: string; name?: string; start: Date; key: string}): Promise<BookResult>;
  upcoming(salonId: string, phone: string, now: Date): Promise<UpcomingBooking[]>;
  cancel(salonId: string, bookingId: string, phone: string): Promise<{ok: true} | {ok: false; reason: "too_late" | "not_found" | "error"}>;
}
