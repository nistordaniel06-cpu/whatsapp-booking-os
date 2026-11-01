"use client";

import { useState } from "react";

const services = [
  { name: "Tuns", minutes: 30 },
  { name: "Tuns + barbă", minutes: 45 },
];

export default function Demo() {
  const [service, setService] = useState(services[0].name);
  const [barber, setBarber] = useState("Daniel");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("18:00");
  const [done, setDone] = useState(false);

  return (
    <main className="min-h-screen p-5 max-w-lg mx-auto">
      <div className="text-yellow-400 font-bold mb-6">
        WA BOOKING / SIMULATOR
      </div>
      <div className="bg-zinc-900 rounded-3xl p-5 space-y-5">
        <h1 className="text-2xl font-bold">Salut! 💈</h1>
        <p className="text-zinc-400">
          Alege serviciul și ora pentru o simulare.
          Disponibilitatea nu este încă conectată la baza de date.
        </p>

        <label className="block">
          Serviciu
          <select
            className="block mt-2 w-full bg-zinc-800 p-3 rounded-xl"
            value={service}
            onChange={(event) => {
              setService(event.target.value);
              setDone(false);
            }}
          >
            {services.map((item) => (
              <option key={item.name}>{item.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          Frizer
          <select
            className="block mt-2 w-full bg-zinc-800 p-3 rounded-xl"
            value={barber}
            onChange={(event) => {
              setBarber(event.target.value);
              setDone(false);
            }}
          >
            <option>Daniel</option>
            <option>Andrei</option>
          </select>
        </label>

        <label className="block">
          Data
          <input
            className="block mt-2 w-full bg-zinc-800 p-3 rounded-xl"
            type="date"
            value={day}
            onChange={(event) => {
              setDay(event.target.value);
              setDone(false);
            }}
          />
        </label>

        <label className="block">
          Ora
          <input
            className="block mt-2 w-full bg-zinc-800 p-3 rounded-xl"
            type="time"
            value={time}
            onChange={(event) => {
              setTime(event.target.value);
              setDone(false);
            }}
          />
        </label>

        <button
          disabled={!day}
          onClick={() => setDone(true)}
          className="w-full bg-yellow-400 text-black rounded-xl p-3 font-bold disabled:opacity-40"
        >
          Simulează confirmarea
        </button>

        {done && (
          <div className="bg-green-950 rounded-xl p-3">
            Simulare: {service} cu {barber}, {day} la {time}.
            Nicio rezervare reală nu a fost creată.
          </div>
        )}
      </div>
    </main>
  );
}
