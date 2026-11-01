export type DemoBooking = {id:string;name:string;service:string;barber:string;date:string;time:string;status:"confirmed"|"cancelled"};
const KEY="wa-booking-demo-v2";
export function readBookings():DemoBooking[]{if(typeof window==="undefined")return [];try{const v=JSON.parse(localStorage.getItem(KEY)||"[]");return Array.isArray(v)?v:[]}catch{return []}}
export function saveBookings(items:DemoBooking[]){localStorage.setItem(KEY,JSON.stringify(items));window.dispatchEvent(new Event("demo-bookings-changed"))}
export function addBooking(item:DemoBooking){const existing=readBookings();if(existing.some(b=>b.status==="confirmed"&&b.barber===item.barber&&b.date===item.date&&b.time===item.time))return false;saveBookings([...existing,item]);return true}
export function cancelBooking(id:string){saveBookings(readBookings().map(b=>b.id===id?{...b,status:"cancelled"}:b))}
