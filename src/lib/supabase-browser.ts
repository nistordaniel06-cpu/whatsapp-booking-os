"use client";
import {createClient} from "@supabase/supabase-js";
export function supabaseBrowser(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw new Error("Supabase environment not configured");
 return createClient(url,key);
}
