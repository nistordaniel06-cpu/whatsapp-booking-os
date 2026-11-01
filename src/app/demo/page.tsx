"use client";
import {useState} from "react";
import Link from "next/link";
import {addBooking} from "@/lib/demo-store";
const services=["Tuns","Tuns + barbă","Barbă"];
const barbers=["Daniel","Andrei"];
const times=["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"];
type Step="start"|"service"|"barber"|"date"|"time"|"name"|"done";
export default function Demo(){
 const [step,setStep]=useState<Step>("start");
 const [service,setService]=useState("");
 const [barber,setBarber]=useState("");
 const [date,setDate]=useState("");
 const [time,setTime]=useState("");
 const [name,setName]=useState("");
 const [error,setError]=useState("");
 const [messages,setMessages]=useState<{from:"bot"|"client";text:string}[]>([{from:"bot",text:"Salut! 💈 Sunt asistentul 4MEN. Te ajut să te programezi. Începem?"}]);
 function say(answer:string,next:Step,prompt:string){setMessages(m=>[...m,{from:"client",text:answer},{from:"bot",text:prompt}]);setStep(next);setError("")}
 function confirm(){if(!name.trim())return;const ok=addBooking({id:crypto.randomUUID(),name:name.trim(),service,barber,date,time,status:"confirmed"});if(!ok){setError("Intervalul este deja ocupat în acest simulator. Alege altă oră.");setStep("time");return}say(name,"done","✅ Programare DEMO confirmată: "+service+" cu "+barber+", "+date+" la "+time+". Nu a fost trimis niciun mesaj WhatsApp real.")}
 const button="rounded-xl bg-[#202b27] border border-[#355348] px-4 py-3 text-left hover:bg-[#30443a]";
 return <main className="min-h-screen bg-[#0b141a] text-white p-4 pb-12">
 <div className="max-w-xl mx-auto">
 <header className="flex items-center justify-between bg-[#202c33] rounded-2xl p-4 mb-4"><div><div className="font-bold text-lg">💈 4MEN Reception</div><div className="text-xs text-green-400">Simulator WhatsApp · V2</div></div><Link href="/pro" className="text-sm text-yellow-400">Calendar PRO →</Link></header>
 <div className="space-y-3 min-h-64">{messages.map((m,i)=><div key={i} className={`max-w-[88%] p-3 rounded-xl whitespace-pre-line ${m.from==="bot"?"bg-[#202c33]":"bg-[#005c4b] ml-auto"}`}>{m.text}</div>)}</div>
 <div className="mt-5 grid gap-2">
 {step==="start"&&<button className={button} onClick={()=>say("Vreau o programare","service","Ce serviciu dorești?")}>📅 Vreau o programare</button>}
 {step==="service"&&services.map(s=><button key={s} className={button} onClick={()=>{setService(s);say(s,"barber","La ce frizer dorești?")}}>{s}</button>)}
 {step==="barber"&&barbers.map(b=><button key={b} className={button} onClick={()=>{setBarber(b);say(b,"date","Pentru ce dată?")}}>{b}</button>)}
 {step==="date"&&<div className="flex gap-2"><input aria-label="Data" className="bg-[#202c33] rounded-xl p-3 flex-1 min-w-0" type="date" min={new Date().toLocaleDateString("en-CA")} value={date} onChange={e=>setDate(e.target.value)}/><button disabled={!date} className="bg-green-700 rounded-xl px-5 disabled:opacity-40" onClick={()=>say(date,"time","Ce oră preferi? Orele de mai jos sunt demonstrative.")}>Continuă</button></div>}
 {step==="time"&&times.map(t=><button key={t} className={button} onClick={()=>{setTime(t);say(t,"name","Pe ce nume facem programarea demo?")}}>{t}</button>)}
 {step==="name"&&<form className="flex gap-2" onSubmit={e=>{e.preventDefault();confirm()}}><input aria-label="Nume" className="bg-[#202c33] rounded-xl p-3 flex-1 min-w-0" placeholder="Prenume" value={name} onChange={e=>setName(e.target.value)}/><button className="bg-green-700 rounded-xl px-4">Confirmă</button></form>}
 {error&&<p role="alert" className="text-red-400">{error}</p>}
 {step==="done"&&<Link className={button} href="/pro">Vezi programarea în calendar →</Link>}
 <button className="text-sm text-zinc-400 mt-4 underline" onClick={()=>{setStep("start");setMessages([{from:"bot",text:"Salut! Începem o nouă programare demo?"}]);setError("")}}>Reîncepe conversația</button>
 </div><p className="text-xs text-zinc-500 mt-8">Datele sunt salvate doar în acest browser. Nu există sincronizare cu Supabase sau WhatsApp.</p>
 </div></main>
}
