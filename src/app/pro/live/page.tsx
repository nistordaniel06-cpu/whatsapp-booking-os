"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {supabaseBrowser} from "@/lib/supabase-browser";
export default function Live(){
 const [status,setStatus]=useState("Verificare acces...");
 useEffect(()=>{const db=supabaseBrowser();db.auth.getUser().then(({data,error})=>{if(error||!data.user){setStatus("Nu ești autentificat. Intră în cont pentru acces la date reale.");return}db.from("bookings").select("id,starts_at,status").limit(10).then(({data:rows,error:readError})=>setStatus(readError?"Acces restricționat: "+readError.message:"Programări vizibile: "+(rows?.length??0)))})},[]);
 return <main className="min-h-screen bg-zinc-950 text-white p-6"><h1 className="text-2xl font-bold">Calendar PRO · Live</h1><p className="my-6">{status}</p><Link href="/login" className="text-yellow-400">Autentificare PRO</Link></main>
}