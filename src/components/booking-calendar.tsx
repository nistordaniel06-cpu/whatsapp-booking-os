"use client";
import {useEffect,useMemo,useRef,useState} from "react";
type Staff={id:string;name:string};
type Booking={id:string;starts_at:string;ends_at:string;status:string;staff_id:string;client?:{name:string|null}|null;service?:{name:string}|null};
type Props={staff:Staff[];bookings:Booking[];onNew:(day:string,time:string,staffId:string)=>void};
const TZ="Europe/Bucharest";
function parts(iso:string){const v=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(iso));const x=Object.fromEntries(v.map(p=>[p.type,p.value]));return {day:`${x.year}-${x.month}-${x.day}`,minutes:Number(x.hour)*60+Number(x.minute)}}
function localToday(){const p=parts(new Date().toISOString());return p.day}
function addDay(s:string,n:number){const d=new Date(s+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function label(s:string){return new Date(s+"T12:00:00Z").toLocaleDateString("ro-RO",{weekday:"short",day:"numeric",month:"short",timeZone:"UTC"})}
export default function BookingCalendar({staff,bookings,onNew}:Props){
 const [day,setDay]=useState(localToday),[mode,setMode]=useState<1|3|7>(1),[filter,setFilter]=useState("all"),[selected,setSelected]=useState<Booking|null>(null);
 const scroller=useRef<HTMLDivElement>(null);
 const days=useMemo(()=>Array.from({length:mode},(_,i)=>addDay(day,i)),[day,mode]);
 const shownStaff=staff.filter(s=>filter==="all"||s.id===filter);
 const active=bookings.filter(b=>b.status!=="cancelled");
 const visible=active.filter(b=>days.includes(parts(b.starts_at).day)&&shownStaff.some(s=>s.id===b.staff_id));
 const hours=Array.from({length:12},(_,i)=>i+9);
 const columns=mode===1?shownStaff.map(s=>({day,staff:s})):days.map(d=>({day:d,staff:shownStaff[0]})).filter((x):x is {day:string;staff:Staff}=>Boolean(x.staff));
 useEffect(()=>{const el=scroller.current;if(!el)return;const current=visible.length?Math.min(...visible.map(b=>parts(b.starts_at).minutes)):new Date().getHours()*60;el.scrollTop=Math.max(0,((Math.max(9*60,current)-9*60)/60)*58-116)},[day,mode,filter,bookings.length]);
 const slotHeight=58;
 return <section className="rounded-3xl bg-[#17181b] border border-zinc-800 p-3 sm:p-4">
 <div className="flex flex-wrap justify-between items-center gap-3 mb-4"><div><h2 className="text-xl font-bold">Agenda</h2><p className="text-xs text-zinc-400">{visible.length} programări în interval</p></div><div className="flex bg-zinc-900 rounded-xl p-1">{([1,3,7] as const).map(n=><button key={n} onClick={()=>setMode(n)} className={`px-3 py-2 text-xs rounded-lg ${mode===n?"bg-yellow-400 text-black font-bold":"text-zinc-300"}`}>{n===1?"Zi":n===3?"3 zile":"Săpt."}</button>)}</div></div>
 <div className="flex items-center gap-2 mb-4"><button aria-label="Ziua precedentă" className="bg-zinc-800 rounded-xl px-3 py-2" onClick={()=>setDay(addDay(day,-mode))}>‹</button><button className="bg-zinc-800 rounded-xl px-3 py-2 text-sm" onClick={()=>setDay(localToday())}>Astăzi</button><button aria-label="Ziua următoare" className="bg-zinc-800 rounded-xl px-3 py-2" onClick={()=>setDay(addDay(day,mode))}>›</button><span className="text-sm text-zinc-300 ml-auto">{label(day)}</span></div>
 <select aria-label="Filtrează frizer" className="bg-zinc-800 rounded-xl p-3 w-full mb-4" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Toți frizerii</option>{staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
 {columns.length===0?<p className="p-5 text-zinc-400">Nu există frizeri configurați.</p>:<div ref={scroller} className="overflow-auto rounded-xl border border-zinc-800 max-h-[62vh]"><div style={{minWidth:Math.max(300,columns.length*125+54)}}>
 <div className="flex sticky top-0 z-10 bg-zinc-900"><div className="w-[54px] shrink-0"/>{columns.map((c,i)=><div key={c.day+c.staff.id+i} className="flex-1 min-w-0 p-2 text-center border-l border-zinc-800"><div className="text-xs text-zinc-400">{label(c.day)}</div><div className="font-semibold text-sm truncate">{c.staff.name}</div></div>)}</div>
 <div className="flex"><div className="w-[54px] shrink-0 bg-zinc-950">{hours.map(h=><div key={h} style={{height:slotHeight}} className="text-xs text-zinc-400 px-2 pt-1 border-t border-zinc-800">{String(h).padStart(2,"0")}:00</div>)}</div>
 {columns.map((col,i)=><div key={col.day+col.staff.id+i} className="flex-1 relative border-l border-zinc-800" style={{height:hours.length*slotHeight}}>
 {hours.map(h=><button key={h} title="Adaugă programare" aria-label={`Adaugă programare ${col.staff.name} ${col.day} ${h}:00`} onClick={()=>onNew(col.day,String(h).padStart(2,"0")+":00",col.staff.id)} className="absolute left-0 w-full border-t border-zinc-800 hover:bg-yellow-400/10" style={{top:(h-9)*slotHeight,height:slotHeight}}/>)}
 {active.filter(b=>b.staff_id===col.staff.id&&parts(b.starts_at).day===col.day).map(b=>{const start=parts(b.starts_at).minutes;const end=parts(b.ends_at).minutes;const top=(start-540)/60*slotHeight;const height=Math.max(25,(end-start)/60*slotHeight);if(top+height<0||top>hours.length*slotHeight)return null;return <button key={b.id} onClick={()=>setSelected(b)} className="absolute left-1 right-1 z-[1] bg-[#57481a] border-l-4 border-yellow-400 rounded-lg px-2 py-1 text-left overflow-hidden shadow-lg" style={{top:Math.max(0,top),height:Math.min(height,hours.length*slotHeight-Math.max(0,top))}}><div className="text-[11px] font-bold text-yellow-200">{String(Math.floor(start/60)).padStart(2,"0")}:{String(start%60).padStart(2,"0")}</div><div className="text-xs font-semibold truncate">{b.client?.name||"Client"}</div><div className="text-[10px] truncate">{b.service?.name||b.status}</div></button>})}</div>)}</div></div></div>}
 {selected&&<div role="dialog" aria-modal="true" aria-label="Detalii programare" className="fixed inset-0 z-50 bg-black/75 flex items-end sm:items-center justify-center p-4"><div className="bg-zinc-900 rounded-3xl p-6 w-full max-w-md"><h3 className="text-xl font-bold mb-3">Detalii programare</h3><p className="text-yellow-400">{new Date(selected.starts_at).toLocaleString("ro-RO",{timeZone:TZ})}</p><p className="my-2">{staff.find(s=>s.id===selected.staff_id)?.name} · {selected.client?.name||"Client"} · {selected.service?.name||"Serviciu"} · {selected.status}</p><p className="text-sm text-zinc-400">Modificarea și anularea programărilor vor fi adăugate după configurarea operațiilor securizate.</p><button className="bg-yellow-400 text-black font-bold rounded-xl p-3 w-full mt-5" onClick={()=>setSelected(null)}>Închide</button></div></div>}
 </section>
}
