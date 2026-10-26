/* Notificações da casa (Firebase Cloud Messaging), enviadas pelo GitHub Actions de 15 em 15 minutos.
   Assim o Firebase fica no plano gratuito (Spark), sem cartão.
   Em cada execução, para cada casa:
   - Resumo às 9h (hora de Lisboa), uma vez por dia: contas a pagar, validades a terminar e marcações/compras.
   - Lembrete cerca de 1 hora antes das marcações com hora.
   - "Nova marcação" quando alguém marca algo (avisa os outros telemóveis, não quem marcou).
   O que já foi enviado fica em households/{código}/sent/estado (só o servidor lá chega). */
const {initializeApp, cert} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

const TZ = "Europe/Lisbon";
const APP_URL = process.env.APP_URL;
const SA = process.env.FIREBASE_SERVICE_ACCOUNT;

initializeApp(SA ? {credential: cert(JSON.parse(SA))} : undefined);
const db = getFirestore();

/* ---------- datas na hora de Lisboa ---------- */
function lisbonNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return {date: `${p.year}-${p.month}-${p.day}`, y: +p.year, m: +p.month, d: +p.day, min: +p.hour * 60 + +p.minute};
}
const addDays = (ds, n) => {
  const d = new Date(ds + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
const eur = (v) => (+v || 0).toLocaleString("pt-PT", {style: "currency", currency: "EUR"});
const longDate = (ds) => new Date(ds + "T12:00:00Z").toLocaleDateString("pt-PT", {weekday: "long", day: "numeric", month: "long", timeZone: "UTC"});
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

/* ---------- envio ---------- */
/* Envia para todos os telemóveis da casa (menos "except", se indicado) e apaga tokens que já não valem. */
async function send(code, {title, body, go, tag}, except) {
  const snap = await db.collection(`households/${code}/tokens`).get();
  const docs = snap.docs.filter((d) => d.id !== except && d.get("token"));
  if (!docs.length) return;
  const link = new URL(go ? "#" + go : "", APP_URL).toString();
  /* Só "data": quem mostra a notificação é o service worker da app (docs/sw.js). */
  const res = await getMessaging().sendEach(docs.map((d) => ({
    token: d.get("token"),
    data: {title, body, link, tag: tag || ""},
    webpush: {headers: {Urgency: "high", TTL: "86400"}},
  })));
  await Promise.all(res.responses.map((r, i) => {
    const c = r.error && r.error.code;
    if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token") {
      return docs[i].ref.delete();
    }
    if (r.error) console.warn("Falha no envio:", c);
    return null;
  }));
  console.log(`  enviada (${tag || "sem tag"}) para ${docs.length} telemóvel(is)`);
}

async function load(code, name) {
  return (await db.collection(`households/${code}/${name}`).get()).docs.map((d) => d.data());
}

/* ---------- 9h: contas, validades e resumo do dia ---------- */
async function morning(code, now) {
  const [items, bills, events] = await Promise.all(["items", "bills", "events"].map((n) => load(code, n)));
  const mk = now.date.slice(0, 7);
  const last = new Date(Date.UTC(now.y, now.m, 0)).getUTCDate();

  /* Contas: as mesmas regras dos alertas da app (atrasadas, hoje, próximos 3 dias). */
  const contas = [];
  for (const b of bills) {
    if (b.kind === "income" || !b.day || (b.paid && b.paid[mk])) continue;
    const d = Math.min(b.day, last);
    if (d < now.d) contas.push({o: 0, t: `Atrasada: ${b.name} · ${eur(b.amount)}`});
    else if (d === now.d) contas.push({o: 1, t: `Hoje: ${b.name} · ${eur(b.amount)}`});
    else if (d - now.d <= 3) contas.push({o: 2 + d, t: `Dia ${d}: ${b.name} · ${eur(b.amount)}`});
  }
  if (contas.length) {
    contas.sort((a, b) => a.o - b.o);
    await send(code, {title: contas.length === 1 ? "Conta a pagar" : `${contas.length} contas a pagar`,
      body: contas.map((c) => c.t).join("\n"), go: "despesas", tag: "contas"});
  }

  /* Validades a terminar nos próximos 3 dias (ou já passadas). */
  const val = items.map((i) => ({i, d: i.exp ? daysBetween(now.date, i.exp) : null}))
      .filter((x) => x.d !== null && x.d <= 3).sort((a, b) => a.d - b.d);
  if (val.length) {
    const txt = (d) => d < 0 ? "passou do prazo" : d === 0 ? "termina hoje" : d === 1 ? "termina amanhã" : `termina em ${d} dias`;
    const soCarne = val.every((x) => ["Carne", "Peixe"].includes(x.i.cat));
    await send(code, {title: val.length === 1 ? "Validade a terminar" : `${val.length} validades a terminar`,
      body: val.map((x) => `${x.i.name} — ${txt(x.d)}`).join("\n"), go: soCarne ? "carne" : "despensa", tag: "validades"});
  }

  /* Resumo do dia: marcações de hoje e amanhã e lista de compras. */
  const byTime = (a, b) => (a.time || "99").localeCompare(b.time || "99");
  const tom = addDays(now.date, 1);
  const hoje = events.filter((e) => e.date === now.date).sort(byTime);
  const amanha = events.filter((e) => e.date === tom).sort(byTime);
  const toBuy = items.filter((i) => i.lvl < 2).length;
  const linhas = [
    ...hoje.map((e) => `${e.time || "Hoje"} · ${e.title}`),
    ...amanha.map((e) => `Amanhã${e.time ? " às " + e.time : ""} · ${e.title}`),
  ];
  if (toBuy) linhas.push(`${plural(toBuy, "produto", "produtos")} para comprar`);
  if (linhas.length) {
    await send(code, {title: hoje.length ? `Bom dia! ${plural(hoje.length, "marcação", "marcações")} hoje` : "Bom dia! Resumo da casa",
      body: linhas.join("\n"), go: hoje.length || amanha.length ? "calendario" : "compras", tag: "resumo"});
  }
}

/* ---------- uma casa ---------- */
async function house(code, now) {
  const ref = db.doc(`households/${code}/sent/estado`);
  const snap = await ref.get();
  const first = !snap.exists;
  const st = {resumo: "", vistos: [], lembrados: [], ...(snap.exists ? snap.data() : {})};

  /* Só as marcações de hoje em diante: as que contam para lembretes e para "nova marcação". */
  const evSnap = await db.collection(`households/${code}/events`).where("date", ">=", now.date).get();
  const evs = evSnap.docs.map((d) => ({...d.data(), id: d.id}));
  const ids = new Set(evs.map((e) => e.id));
  const vistos = new Set(st.vistos.filter((id) => ids.has(id)));
  const lembrados = new Set(st.lembrados.filter((id) => ids.has(id)));

  /* Primeiro decide-se o que enviar e grava-se o estado; só depois se envia (assim nunca se repete). */
  const jobs = [];

  /* Nova marcação (na primeira execução só regista as que já existem, sem avisar). */
  for (const e of evs) {
    if (vistos.has(e.id)) continue;
    vistos.add(e.id);
    if (!first) {
      jobs.push(() => send(code, {title: "Nova marcação", body: `${e.title} · ${longDate(e.date)}${e.time ? " às " + e.time : ""}`,
        go: "calendario", tag: "nova-" + e.id}, e.by));
    }
  }

  /* Lembrete: marcações com hora que começam nos próximos 75 minutos (margem para atrasos do GitHub). */
  const tom = addDays(now.date, 1);
  for (const e of evs) {
    if (lembrados.has(e.id) || !/^\d{2}:\d{2}$/.test(e.time || "")) continue;
    if (e.date !== now.date && e.date !== tom) continue;
    const [hh, mm] = e.time.split(":").map(Number);
    const diff = hh * 60 + mm + (e.date === tom ? 1440 : 0) - now.min;
    if (diff <= 0 || diff > 75) continue;
    lembrados.add(e.id);
    jobs.push(() => send(code, {title: e.title, body: `${e.date === tom ? "Amanhã" : "Hoje"} às ${e.time} (daqui a ${diff} min)`,
      go: "calendario", tag: "ev-" + e.id}));
  }

  /* Resumo diário: a partir das 9h, uma vez por dia (até às 21h, se o GitHub tiver falhado de manhã). */
  let resumo = st.resumo;
  if (resumo !== now.date && now.min >= 9 * 60 && now.min < 21 * 60) {
    resumo = now.date;
    jobs.push(() => morning(code, now));
  }

  await ref.set({resumo, vistos: [...vistos], lembrados: [...lembrados], at: new Date()});
  for (const job of jobs) await job();
}

(async () => {
  if (!APP_URL) throw new Error("Falta APP_URL");
  const now = lisbonNow();
  const codes = (await db.collection("households").listDocuments()).map((r) => r.id);
  console.log(`Lisboa ${now.date} ${String(Math.floor(now.min / 60)).padStart(2, "0")}:${String(now.min % 60).padStart(2, "0")} · ${codes.length} casa(s)`);
  let fail = 0;
  for (const [n, code] of codes.entries()) {
    console.log(`Casa ${n + 1}`);
    try {
      await house(code, now);
    } catch (e) {
      fail++;
      console.error("Falhou:", e.message);
    }
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
