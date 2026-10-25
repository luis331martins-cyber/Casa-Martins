/* Notificações da casa (Firebase Cloud Messaging).
   - resumoDiario: às 9h (hora de Lisboa) envia contas a vencer, validades a terminar e o resumo do dia.
   - lembretesMarcacoes: de 15 em 15 minutos avisa das marcações com hora que começam na próxima hora.
   - novaMarcacao: quando alguém marca algo no calendário, avisa os outros telemóveis da casa. */
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {setGlobalOptions, logger} = require("firebase-functions/v2");
const {defineString} = require("firebase-functions/params");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue, Timestamp} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

const TZ = "Europe/Lisbon";
/* Tem de ser a mesma região (localização) que escolheste para a base de dados Firestore. */
setGlobalOptions({region: "europe-west1", maxInstances: 2});

const APP_URL = defineString("APP_URL", {
  description: "Endereço da app no GitHub Pages, ex.: https://o-teu-utilizador.github.io/Casa-Martins/",
});

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
  const link = new URL(go ? "#" + go : "", APP_URL.value()).toString();
  /* Só "data": quem mostra a notificação é o service worker da app (sw.js). */
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
    if (r.error) logger.warn("Falha no envio", code, c);
    return null;
  }));
}

async function households() {
  return (await db.collection("households").listDocuments()).map((r) => r.id);
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
    if (!b.day || (b.paid && b.paid[mk])) continue;
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

exports.resumoDiario = onSchedule({schedule: "0 9 * * *", timeZone: TZ}, async () => {
  const now = lisbonNow();
  for (const code of await households()) {
    try {
      await morning(code, now);
      /* Limpa os registos de lembretes já enviados com mais de 3 dias. */
      const old = await db.collection(`households/${code}/sent`)
          .where("at", "<", Timestamp.fromMillis(Date.now() - 3 * 864e5)).get();
      await Promise.all(old.docs.map((d) => d.ref.delete()));
    } catch (e) {
      logger.error("Resumo diário falhou", code, e);
    }
  }
});

/* ---------- lembrete 1 hora antes das marcações com hora ---------- */
exports.lembretesMarcacoes = onSchedule({schedule: "every 15 minutes", timeZone: TZ}, async () => {
  const now = lisbonNow();
  const tom = addDays(now.date, 1);
  for (const code of await households()) {
    try {
      const snap = await db.collection(`households/${code}/events`).where("date", "in", [now.date, tom]).get();
      for (const doc of snap.docs) {
        const e = doc.data();
        if (!/^\d{2}:\d{2}$/.test(e.time || "")) continue;
        const [hh, mm] = e.time.split(":").map(Number);
        const diff = hh * 60 + mm + (e.date === tom ? 1440 : 0) - now.min;
        if (diff <= 0 || diff > 60) continue;
        /* Marca como enviado antes de enviar, para nunca repetir. */
        try {
          await db.doc(`households/${code}/sent/lembrete-${doc.id}`).create({at: FieldValue.serverTimestamp()});
        } catch (err) {
          if (err.code === 6) continue; // já enviado
          throw err;
        }
        await send(code, {title: e.title, body: `${e.date === tom ? "Amanhã" : "Hoje"} às ${e.time} (daqui a ${diff} min)`,
          go: "calendario", tag: "ev-" + doc.id});
      }
    } catch (e) {
      logger.error("Lembretes falharam", code, e);
    }
  }
});

/* ---------- nova marcação feita no outro telemóvel ---------- */
exports.novaMarcacao = onDocumentCreated("households/{code}/events/{id}", async (event) => {
  const e = event.data && event.data.data();
  if (!e || !e.date || e.date < lisbonNow().date) return;
  await send(event.params.code, {title: "Nova marcação", body: `${e.title} · ${longDate(e.date)}${e.time ? " às " + e.time : ""}`,
    go: "calendario", tag: "nova-" + event.params.id}, e.by);
});
