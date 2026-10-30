/* Notificações da casa (Firebase Cloud Messaging), enviadas pelo GitHub Actions de 15 em 15 minutos.
   Assim o Firebase fica no plano gratuito (Spark), sem cartão.
   Em cada execução, para cada casa:
   - Resumo às 9h (hora de Lisboa), uma vez por dia: contas a pagar, validades a terminar e marcações/compras.
   - Lembrete cerca de 1 hora antes das marcações com hora.
   - "Nova marcação" quando alguém marca algo (avisa os outros telemóveis, não quem marcou).
   - Mensagens do chat da casa (avisa os outros telemóveis, não quem escreveu).
   O que já foi enviado fica em households/{código}/sent/estado (só o servidor lá chega). */
const {initializeApp, cert} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

const TZ = "Europe/Lisbon";
const START = "2026-11";
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
/* 3.589,57 € — ponto nos milhares e vírgula nos cêntimos, como na app */
const eur = (v) => {
  v = Math.round((+v || 0) * 100) / 100;
  const [i, d] = Math.abs(v).toFixed(2).split(".");
  return (v < 0 ? "−" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + d + "\u00a0€";
};
const longDate = (ds) => new Date(ds + "T12:00:00Z").toLocaleDateString("pt-PT", {weekday: "long", day: "numeric", month: "long", timeZone: "UTC"});
/* Valor de uma conta num mês (igual à app): só nesse mês, em vigor desde um mês, ou o valor habitual */
const baseAmt = (b, k) => {
  let v = +b.amount || 0;
  if (b.from) for (const m of Object.keys(b.from).sort()) if (m <= k) v = +b.from[m] || 0;
  return v;
};
const monthAmt = (b, k) => b.amounts && b.amounts[k] != null ? +b.amounts[k] :
  typeof (b.paid && b.paid[k]) === "number" ? b.paid[k] : baseAmt(b, k);
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

/* ---------- envio ---------- */
/* Envia para todos os telemóveis da casa (menos "except", se indicado) e apaga tokens que já não valem. */
async function send(code, {title, body, go, tag, k}, except) {
  const snap = await db.collection(`households/${code}/tokens`).get();
  const docs = snap.docs.filter((d) => d.id !== except && d.get("token"));
  if (!docs.length) return;
  const link = new URL(go ? "#" + go : "", APP_URL).toString();
  /* Só "data": quem mostra a notificação é o service worker da app (docs/sw.js). */
  const res = await getMessaging().sendEach(docs.map((d) => ({
    token: d.get("token"),
    data: {title, body, link, tag: tag || "", ...(k ? {k} : {})},
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
/* Fim do mês: no último dia útil (e até dia 5 do mês seguinte, se ficou por fazer) faltam escrever estas receitas
   (ordenados, cartão Break, caixa…), como a janela da app. Devolve {k, faltam}. */
function entradasFaltam(bills, now) {
  const mk = now.date.slice(0, 7), last = new Date(Date.UTC(now.y, now.m, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    const fixos = ["01-01", "04-25", "05-01", "06-10", "08-15", "10-05", "11-01", "12-01", "12-08", "12-25"];
    const pascoa = (y) => { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = (h + l - 7 * m + 114) % 31 + 1; return `${y}-${pad(mo)}-${pad(da)}`; };
    const feriado = (ds) => fixos.includes(ds.slice(5)) || [-2, 0, 60].some((n) => addDays(pascoa(+ds.slice(0, 4)), n) === ds);
    let ult = `${now.y}-${pad(now.m)}-${pad(last)}`;
    while ([0, 6].includes(new Date(ult + "T12:00:00Z").getUTCDay()) || feriado(ult)) ult = addDays(ult, -1);
    const k = now.date >= ult ? mk : now.d <= 5 ? (now.m === 1 ? `${now.y - 1}-12` : `${now.y}-${pad(now.m - 1)}`) : null;
    const sem = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const faltam = k && k >= "2026-10" ? bills.filter((b) => b.kind === "income" && (b.ask != null ? !!b.ask : /ordenado|salario|vencimento|break|caixa/.test(sem(b.name))) && !(b.iconf && b.iconf[k])) : [];
  return {k, faltam};
}

async function morning(code, now) {
  /* Tudo o que sai às 9h vai numa só notificação "Bom dia" (contas, valores, validades, prazos e o resumo do dia) */
  const partes = [];
  const [items, bills, events] = await Promise.all(["items", "bills", "events"].map((n) => load(code, n)));
  const mk = now.date.slice(0, 7);
  const last = new Date(Date.UTC(now.y, now.m, 0)).getUTCDate();

  /* Contas: as mesmas regras dos alertas da app (atrasadas, hoje, próximos 3 dias).
     Débito direto (dd) não fica "atrasado": avisa só no dia e nos 3 dias antes, para haver saldo. */
  const contas = [];
  /* A app começa a contar em novembro de 2026: antes disso não há contas para avisar */
  if (mk >= START) for (const b of bills) {
    if (b.kind || !b.day || b.acm === "all") continue; // só contas fixas (as pagas por outra pessoa ficam de fora) (receitas, gastos do mês, contas bancárias e pratos têm kind)
    const p = b.paid && b.paid[mk];
    if (p != null && p !== false) continue;
    const dd = b.dd && p !== false;
    const d = Math.min(b.day, last);
    const v = eur(monthAmt(b, mk));
    if (d < now.d) {
      if (!dd) contas.push({o: 0, t: `Atrasada: ${b.name} · ${v}`});
    } else if (d === now.d) contas.push({o: 1, t: `${dd ? "Débito hoje" : "Hoje"}: ${b.name} · ${v}`});
    else if (d - now.d <= 3) contas.push({o: 2 + d, t: `${dd ? "Débito dia" : "Dia"} ${d}: ${b.name} · ${v}`});
  }
  if (contas.length) {
    contas.sort((a, b) => a.o - b.o);
    partes.push({title: contas.length === 1 ? "Conta a pagar" : `${contas.length} contas a pagar`,
      body: contas.map((c) => c.t).join("\n"), go: "despesas", tag: "contas"});
  }

  /* Contagem da água, luz, gás: avisa nos 3 dias antes do dia limite (b.rd) e no próprio dia, até ser marcada como dada */
  const leit = [];
  for (const b of bills) {
    if (b.kind || !b.rd || (b.rdone && b.rdone[mk])) continue;
    const d = Math.min(b.rd, last), falta = d - now.d;
    if (falta < 0 || falta > 3) continue;
    leit.push({o: falta, t: `${b.name}: ${falta === 0 ? "último dia é hoje" : falta === 1 ? "até amanhã" : `até dia ${d}`}`});
  }
  /* Vai numa notificação própria (dentro do "Bom dia" passava despercebida) */
  console.log(`  contagem: ${leit.length}`);
  if (leit.length) {
    leit.sort((a, b) => a.o - b.o);
    await send(code, {title: `📟 Dar a contagem${leit.length > 1 ? ` (${leit.length})` : ""}`,
      body: leit.map((x) => x.t).join("\n") + "\nToca para marcar como dada.", go: "despesas", tag: "contagem"});
  }

  /* Fim do mês: o que entrou (ordenados, Break, caixa) — notificação própria às 9h e outra às 19h se ainda faltar */
  {
    const {k, faltam} = entradasFaltam(bills, now);
    if (faltam.length) await send(code, {title: "💶 Escreve o que entrou", body: faltam.map((b) => b.name).join(", ") + "\nToca para escrever os valores.", go: "despesas", tag: "entradas-" + k});
  }

  /* Por confirmar: débitos diretos / entradas automáticas deste mês que já passaram e marcações dos últimos 7 dias */
  {
    const conf = [];
    if (mk >= START) for (const b of bills) {
      if ((b.kind && b.kind !== "income") || !b.dd || !b.day) continue;
      const p = b.paid && b.paid[mk];
      if (p === false || (b.ok && b.ok[mk]) || Math.min(b.day, last) >= now.d) continue;
      conf.push(`${b.name} (${b.kind === "income" ? "entrou?" : "saiu?"})`);
    }
    const lim = addDays(now.date, -7);
    for (const e of events) {
      const fim = e.end && e.end > e.date ? e.end : e.date;
      if (e.done || e.skip || fim >= now.date || fim < lim || /^🎒.*(Férias|Feriado)/.test(e.title || "")) continue;
      conf.push(`${e.title} (feito?)`);
    }
    if (conf.length) partes.push({title: `✅ Por confirmar (${conf.length})`, body: conf.slice(0, 6).join(", ") + (conf.length > 6 ? "…" : ""), go: "inicio", tag: "confirmar"});
  }

  /* Viagens: uma semana antes e na véspera, com o que falta arrumar na mala */
  {
    const vg = [];
    for (const b of bills) {
      if (b.kind !== "trip" || !/^\d{4}-\d{2}-\d{2}$/.test(b.from || "")) continue;
      const d = daysBetween(now.date, b.from);
      if (![7, 1].includes(d)) continue;
      const P = Array.isArray(b.pack) ? b.pack : [], falta = P.filter((x) => !x.done).length;
      vg.push(`${b.name} ${d === 1 ? "é amanhã" : "é daqui a uma semana"}${P.length ? (falta ? ` · faltam ${falta} coisas na mala` : " · mala pronta") : ""}`);
    }
    if (vg.length) partes.push({title: "✈️ Viagem", body: vg.join("\n"), go: "viagens", tag: "viagens"});
  }

  /* Aniversários: 7 dias antes, na véspera e no dia */
  {
    const anos = [];
    for (const b of bills) {
      if (b.kind !== "bday" || !/^\d{2}-\d{2}$/.test(b.md || "")) continue;
      let dt = `${now.y}-${b.md}`;
      if (dt < now.date) dt = `${now.y + 1}-${b.md}`;
      const d = daysBetween(now.date, dt);
      if (![7, 1, 0].includes(d)) continue;
      const idade = b.year ? +dt.slice(0, 4) - b.year : null;
      anos.push({d, t: d === 0 ? `Hoje: ${b.name}${idade ? ` faz ${idade} anos` : ""} 🎉` : `${d === 1 ? "Amanhã" : "Daqui a 7 dias"}: ${b.name}${idade ? ` (${idade} anos)` : ""}`});
    }
    if (anos.length) {
      anos.sort((a, b) => a.d - b.d);
      partes.push({title: "🎂 Aniversários", body: anos.map((x) => x.t).join("\n"), go: "aniversarios", tag: "anos"});
    }
  }

  /* Acerto com a Mãe (ou outra pessoa): a dia 5 lembra quanto passa (metade das contas "half" do mês menos as "all" do mês anterior) */
  if (now.d === 5 && mk >= START) {
    const pk = now.m === 1 ? `${now.y - 1}-12` : `${now.y}-${String(now.m - 1).padStart(2, "0")}`;
    const AC = bills.filter((b) => !b.kind && b.ac && b.acm);
    for (const w of [...new Set(AC.map((b) => b.ac))]) {
      const rec = bills.find((x) => x.kind === "acerto" && x.who === w);
      if (rec && rec.done && rec.done[mk]) continue;
      const tot = AC.filter((b) => b.ac === w).reduce((t, b) => t + (b.acm === "half" ? monthAmt(b, mk) / 2 : -monthAmt(b, pk)), 0);
      partes.push({title: `🤝 Acerto com ${w} hoje`, body: tot >= 0 ? `${w} passa-te ${eur(tot)}` : `Passas a ${w} ${eur(-tot)}`, go: "despesas", tag: "acerto-" + mk});
    }
  }

  /* Valores que mudam todos os meses (cartões, água, luz…): pede cada um no dia em que se fica a saber o valor
     (b.askDay; por defeito CGD Gold 11, WiZink 17, ActivoBank 1, Galp/Luz 25, Água/SMAS 2, Vodafone 25), igual à app. */
  {
    const semAcento = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const ym = (y, m) => { const d = new Date(Date.UTC(y, m - 1, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
    const pede = (b) => !b.kind && (b.ask != null ? !!b.ask : /cgd gold|wizink|activo ?bank gold|\bagua\b|\bluz\b|vodafone|smas/.test(semAcento(b.name)));
    const askDayOf = (b) => { if (b.askDay != null) return +b.askDay || null; const n = semAcento(b.name);
      return /cgd gold|caixa.*gold/.test(n) ? 11 : /wizink/.test(n) ? 17 : /activo ?bank/.test(n) ? 1 : /vodafone/.test(n) ? 25 : /smas|\bagua\b/.test(n) ? 2 : /\bluz\b|galp/.test(n) ? 25 : null; };
    const cur = ym(now.y, now.m), nx = ym(now.y, now.m + 1), pv = ym(now.y, now.m - 1);
    const alvo = (b) => { const d = askDayOf(b); const tgt = (m, next) => b.acm === "all" ? m : (b.day && b.day > d ? m : next);
      if (!d) return b.acm === "all" ? null : (now.d >= 25 ? nx : null);
      if (now.d >= d) { const k = tgt(cur, nx); return k === cur && b.acm !== "all" && b.day && now.d > b.day ? null : k; }
      return tgt(pv, cur) === cur && (!b.day || now.d <= b.day) ? cur : null; };
    const faltam = bills.map((b) => ({b, k: pede(b) ? alvo(b) : null})).filter((x) => x.k && x.k >= START && !(x.b.conf && x.b.conf[x.k]));
    if (faltam.length) {
      partes.push({title: `📝 Confirma ${plural(faltam.length, "valor", "valores")}`,
        body: faltam.map((x) => x.b.name).join(", "), go: "despesas", tag: "valores-" + now.date});
    }
  }

  /* Validades a terminar nos próximos 3 dias (ou já passadas). */
  const val = items.map((i) => ({i, d: i.exp ? daysBetween(now.date, i.exp) : null}))
      .filter((x) => x.d !== null && x.d <= 3).sort((a, b) => a.d - b.d);
  if (val.length) {
    const txt = (d) => d < 0 ? "passou do prazo" : d === 0 ? "termina hoje" : d === 1 ? "termina amanhã" : `termina em ${d} dias`;
    const soCarne = val.every((x) => ["Carne", "Peixe"].includes(x.i.cat));
    partes.push({title: val.length === 1 ? "Validade a terminar" : `${val.length} validades a terminar`,
      body: val.map((x) => `${x.i.name} — ${txt(x.d)}`).join("\n"), go: soCarne ? "carne" : "despensa", tag: "validades"});
  }

  /* Prazos do carro (30, 7 e 1 dia antes e no dia) e validade dos documentos (90, 30, 7 dias antes e no dia).
     Depois de passar, lembra uma vez por semana durante um mês. */
  const prazos = [];
  const CAR = [["seguro", "Seguro"], ["inspecao", "Inspeção"], ["iuc", "IUC"], ["revisao", "Revisão"]];
  for (const b of bills) {
    if (b.kind === "car") for (const [f, n] of CAR) if (b[f]) prazos.push({date: b[f], t: `${b.name}: ${n}`, at: [30, 7, 1, 0], go: "carro"});
    if (b.kind === "doc" && b.date) prazos.push({date: b.date, t: `${b.type} (${b.who})`, at: [90, 30, 7, 0], go: "docs"});
    if (b.kind === "hins" && b.renew) prazos.push({date: b.renew, t: `Seguro da casa (${b.name})`, at: [60, 30, 7, 0], go: "casa"});
    if (b.kind === "home" && /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") && +b.war > 0) {
      const d = new Date(b.date + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + Math.round(+b.war * 12));
      prazos.push({date: d.toISOString().slice(0, 10), t: `Garantia: ${b.name}`, at: [60, 30, 0], go: "casa"});
    }
    if (b.kind === "hold" && b.end) prazos.push({date: b.end, t: `${b.type}: ${b.name}`, at: [30, 7, 0], go: "poupancas"});
    /* Cartões: válido até ao último dia do mês escrito (AAAA-MM) */
    if (b.kind === "card" && /^\d{4}-\d{2}$/.test(b.exp || "")) {
      const [y, m] = b.exp.split("-").map(Number), fim = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      prazos.push({date: fim, t: `Cartão ${b.name}${b.who ? ` (${b.who})` : ""}`, at: [30, 7, 0], go: "cartoes"});
    }
  }
  const avisar = prazos.map((x) => ({...x, d: daysBetween(now.date, x.date)}))
      .filter((x) => x.at.includes(x.d) || (x.d < 0 && x.d >= -28 && -x.d % 7 === 0)).sort((a, b) => a.d - b.d);
  if (avisar.length) {
    const txt = (d) => d < 0 ? `passou há ${-d} dias` : d === 0 ? "termina hoje" : d === 1 ? "termina amanhã" : `faltam ${d} dias`;
    partes.push({title: avisar.length === 1 ? "Prazo a terminar" : `${avisar.length} prazos a terminar`,
      body: avisar.map((x) => `${x.t} — ${txt(x.d)}`).join("\n"), go: avisar[0].go, tag: "prazos"});
  }

  /* Resumo do dia: marcações de hoje e amanhã e lista de compras. */
  const byTime = (a, b) => (a.time || "99").localeCompare(b.time || "99");
  const tom = addDays(now.date, 1);
  /* Marcações de vários dias (end = último dia) contam em todos os dias */
  const on = (e, ds) => ds >= e.date && ds <= (e.end && e.end > e.date ? e.end : e.date);
  const hoje = events.filter((e) => on(e, now.date)).sort(byTime);
  const amanha = events.filter((e) => e.date === tom).sort(byTime);
  const toBuy = items.filter((i) => i.lvl < 2).length;
  const linhas = [
    ...hoje.map((e) => `${e.time && e.date === now.date ? e.time : "Hoje"} · ${e.title}${e.end && e.end > e.date ?
      ` (dia ${daysBetween(e.date, now.date) + 1} de ${daysBetween(e.date, e.end) + 1})` : ""}`),
    ...amanha.map((e) => `Amanhã${e.time ? " às " + e.time : ""} · ${e.title}`),
  ];
  /* Medicamentos a acabar: comprimidos que restam ÷ (tomas por dia × por toma) */
  for (const m of bills.filter((b) => b.kind === "med" && b.stock != null)) {
    if ((m.start && m.start > now.date) || (m.end && m.end < now.date)) continue;
    const fases = Array.isArray(m.phases) && m.phases.length;
    const hoje = fases ? m.phases[0].from ? m.phases.find((p) => now.date >= p.from && (!p.to || now.date <= p.to)) || null : (() => { const i = m.start ? daysBetween(m.start, now.date) : 0; let acc = 0;
      for (const ph of m.phases) { const d = +ph.days || 0; if (d === 0 || i < acc + d) return ph; acc += d; } return null; })() : m;
    if (!hoje) continue;
    const perDay = (hoje.times || []).length * (+hoje.per || 1);
    const dias = perDay ? Math.floor(m.stock / perDay) : null;
    if (dias !== null && dias <= (m.warnDays || 7)) linhas.push(`💊 Comprar ${m.name} (${m.who}) — dá para ${dias} dia${dias === 1 ? "" : "s"}`);
  }
  if (toBuy) linhas.push(`${plural(toBuy, "produto", "produtos")} para comprar`);
  if (linhas.length) {
    partes.push({title: hoje.length ? `Bom dia! ${plural(hoje.length, "marcação", "marcações")} hoje` : "Bom dia! Resumo da casa",
      body: linhas.join("\n"), go: hoje.length || amanha.length ? "calendario" : "compras", tag: "resumo"});
  }
  if (!partes.length) return;
  const resumo = partes.find((x) => x.tag === "resumo"), outras = partes.filter((x) => x !== resumo);
  const corpo = [...outras.map((x) => `${x.title}: ${x.body.split("\n").join(" · ")}`), ...(resumo ? resumo.body.split("\n") : [])];
  await send(code, {title: resumo ? resumo.title : "Bom dia! 🏠", body: corpo.join("\n"), go: (outras[0] || resumo).go, tag: "bom-dia"});
}

/* ---------- cartões: pagamentos e compras automáticos ----------
   card.auto = [{id, n, v, day, t: "pag"|"compra", bill?: true, since: "AAAA-MM"}].
   No dia (hora de Lisboa) junta o movimento às compras do cartão e acerta o "usado".
   O id do movimento é fixo (auto-<id>-<mês>), por isso nunca entra duas vezes. Vê este mês e o anterior (se falhou algum dia). */
async function cardAuto(code, now) {
  const col = db.collection(`households/${code}/bills`);
  const all = (await col.get()).docs.map((x) => ({...x.data(), id: x.id}));
  const pad = (n) => String(n).padStart(2, "0");
  const prevK = now.m === 1 ? `${now.y - 1}-12` : `${now.y}-${pad(now.m - 1)}`, curK = `${now.y}-${pad(now.m)}`;
  for (const c of all.filter((b) => b.kind === "card" && Array.isArray(b.auto) && b.auto.length)) {
    await db.runTransaction(async (tx) => {
      const ref = col.doc(c.id), snap = await tx.get(ref);
      if (!snap.exists) return;
      const card = snap.data(), buys = Array.isArray(card.buys) ? [...card.buys] : [];
      let used = +card.used || 0, novos = 0;
      for (const a of card.auto || []) {
        for (const mk of [prevK, curK]) {
          if (a.since && mk < a.since) continue;
          const [y, m] = mk.split("-").map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
          const linha = a.bill && card.bill ? all.find((b) => b.id === card.bill) : null;
          const day = Math.min(+(linha ? linha.day : a.day) || 1, last);
          if (mk === curK && now.d < day) continue;
          const id = `auto-${a.id}-${mk}`;
          if (buys.some((x) => x.id === id)) continue;
          const v = Math.round((linha ? monthAmt(linha, mk) : +a.v || 0) * 100) / 100;
          if (!v) continue;
          const mov = a.t === "compra" ? v : -v;
          buys.push({id, v: mov, d: `${mk}-${pad(day)}`, n: a.n || (a.t === "compra" ? "Compra automática" : "Pagamento automático"), auto: true});
          used = Math.max(0, Math.round((used + mov) * 100) / 100);
          novos++;
        }
      }
      if (!novos) return;
      buys.sort((x, y) => String(x.d).localeCompare(String(y.d)));
      tx.update(ref, {buys: buys.slice(-80), used, usedAt: Date.now()});
      console.log(`  cartão: ${novos} movimento(s) automático(s)`);
    });
  }
}

/* ---------- uma casa ---------- */
async function house(code, now) {
  try { await cardAuto(code, now); } catch (e) { console.error("Cartões automáticos:", e.message); }
  const ref = db.doc(`households/${code}/sent/estado`);
  const snap = await ref.get();
  const first = !snap.exists;
  const st = {resumo: "", vistos: [], lembrados: [], meds: [], ...(snap.exists ? snap.data() : {})};
  /* Mensagens já avisadas (ids das últimas 48 h; o relógio de cada telemóvel pode estar um pouco adiantado ou atrasado) */
  const msgPrimeira = !Array.isArray(st.msgs);

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
      const quando = e.end && e.end > e.date ? `de ${longDate(e.date)} a ${longDate(e.end)}` :
        `${longDate(e.date)}${e.time ? " às " + e.time : ""}`;
      /* "Bianca marcou: Jantar com os pais" quando a marcação traz o nome de quem a fez */
      const msg = e.byName ?
        {title: `${e.byName} marcou: ${e.title}`, body: quando[0].toUpperCase() + quando.slice(1)} :
        {title: "Nova marcação", body: `${e.title} · ${quando}`};
      jobs.push(() => send(code, {...msg, go: "calendario", tag: "nova-" + e.id}, e.by));
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

  /* Toma faseada: horários e quantidade da fase do dia (igual à app); última fase com 0 dias continua sempre */
  const plano = (m, ds) => {
    if (!Array.isArray(m.phases) || !m.phases.length) return {times: m.times || [], per: +m.per || 1};
    if (m.phases[0].from) {
      const ph = m.phases.find((p) => ds >= p.from && (!p.to || ds <= p.to));
      return ph ? {times: ph.times || [], per: +ph.per || 1} : null;
    }
    const i = m.start ? daysBetween(m.start, ds) : 0;
    if (i < 0) return null;
    let acc = 0;
    for (const ph of m.phases) {
      const d = +ph.days || 0;
      if (d === 0 || i < acc + d) return {times: ph.times || [], per: +ph.per || 1};
      acc += d;
    }
    return null;
  };
  /* Medicamentos: à hora de cada toma (até 45 min depois, por causa dos atrasos do GitHub), se ainda não foi marcada */
  const medSnap = await db.collection(`households/${code}/bills`).where("kind", "==", "med").get();
  const medsSent = new Set((st.meds || []).filter((k) => k.split("|")[1] === now.date));
  for (const d of medSnap.docs) {
    const m = d.data();
    if ((m.start && m.start > now.date) || (m.end && m.end < now.date)) continue;
    const P = plano(m, now.date);
    if (!P) continue;
    for (const t of P.times) {
      if (!/^\d{2}:\d{2}$/.test(t)) continue;
      const [hh, mm] = t.split(":").map(Number);
      const late = now.min - (hh * 60 + mm);
      const key = `${d.id}|${now.date}|${t}`;
      if (((m.taken || {})[now.date] || []).includes(t)) continue;
      const qt = m.phases && m.phases.length ? " · " + String(P.per).replace(".", ",") + " por toma" : m.dose ? " · " + m.dose : "";
      /* 1.º aviso à hora (até 45 min depois); 2.º "Já tomou?" cerca de 1 hora depois, se ainda não foi marcada */
      if (late >= 0 && late <= 45 && !medsSent.has(key)) {
        medsSent.add(key);
        jobs.push(() => send(code, {title: `💊 ${m.who ? m.who + ": " : ""}${m.name}`,
          body: `Toma das ${t}${qt}${m.notes ? " · " + m.notes : ""}`, go: "medicamentos", tag: "med-" + key, k: key}));
      } else if (late >= 60 && late <= 120 && !medsSent.has(key + "|2")) {
        medsSent.add(key + "|2");
        jobs.push(() => send(code, {title: `💊 Já tomou? ${m.who ? m.who + ": " : ""}${m.name}`,
          body: `A toma das ${t}${qt} ainda não está marcada. Abre a app para marcar.`, go: "medicamentos", tag: "med-" + key, k: key}));
      }
    }
  }

  /* Coisas novas juntadas por alguém da casa: uma notificação por pessoa, para os outros telemóveis.
     Contas, medicamentos, consultas, documentos, carro, créditos, pratos, plano e vídeos novos; e produtos que entram nas compras. */
  const [itemsT, billsT] = await Promise.all(["items", "bills"].map((n) => db.collection(`households/${code}/${n}`).get().then((q) => q.docs.map((x) => ({...x.data(), id: x.id})))));
  const primeiraVez = !Array.isArray(st.seenB);
  const seenB = new Set(st.seenB || []), compraAntes = new Set(st.buy || []);
  const TIPO = {"": ["Conta", "despesas"], income: ["Receita", "despesas"], budget: ["Gastos do mês", "despesas"], med: ["Medicamento", "medicamentos"],
    health: ["Consulta", "saude"], doc: ["Documento", "documentos"], car: ["Carro", "carro"], loan: ["Crédito", "creditos"], card: ["Cartão", "cartoes"], saving: ["Objetivo de poupança", "poupancas"], hold: ["Poupança", "poupancas"], bday: ["Aniversário", "aniversarios"], trip: ["Viagem", "viagens"], home: ["Casa", "casa"], carlog: ["Carro (reparação)", "carro"], recipe: ["Prato", "comer"],
    plan: ["Plano de refeições", "plano"], video: ["Vídeo", "videos"]};
  const porQuem = new Map();
  const juntar = (lb, rotulo, nome, go) => {
    if (!lb || primeiraVez) return;
    const [uid, quem] = String(lb).split("|");
    if (!porQuem.has(uid)) porQuem.set(uid, {quem: quem || "Alguém", go, grupos: new Map()});
    const g = porQuem.get(uid).grupos;
    if (!g.has(rotulo)) g.set(rotulo, []);
    g.get(rotulo).push(nome);
  };
  for (const b of billsT) {
    if (seenB.has(b.id)) continue;
    const t = TIPO[b.kind || ""];
    if (t && !(b.kind === "health" && b.ev)) juntar(b.lb, t[0], b.kind === "health" ? `${b.who}: ${b.title || b.type}` : b.kind === "med" ? `${b.name} (${b.who})` : b.kind === "plan" ? b.date : b.name, t[1]);
  }
  const compraAgora = itemsT.filter((i) => i.lvl < 2).map((i) => i.id);
  for (const i of itemsT) if (i.lvl < 2 && !compraAntes.has(i.id)) juntar(i.lb, "Compras", i.name, "compras");
  for (const [uid, x] of porQuem) {
    const linhas = [...x.grupos].map(([rot, nomes]) => `${rot}: ${nomes.slice(0, 6).join(", ")}${nomes.length > 6 ? "…" : ""}`);
    jobs.push(() => send(code, {title: `🏠 ${x.quem} juntou`, body: linhas.join("\n"), go: x.go, tag: "juntou-" + uid}, uid));
  }
  const novosSeenB = billsT.map((b) => b.id);

  /* Mensagens novas do chat: uma notificação por mensagem, para os outros telemóveis */
  const msgSnap = await db.collection(`households/${code}/bills`).where("kind", "==", "msg").get();
  const recentes = msgSnap.docs.map((d) => ({...d.data(), id: d.id}))
    .filter((m) => typeof m.at === "number" && m.at > Date.now() - 2 * 864e5).sort((a, b) => a.at - b.at);
  const msgVistas = new Set((st.msgs || []).filter((id) => recentes.some((m) => m.id === id)));
  for (const m of recentes) {
    if (msgVistas.has(m.id)) continue;
    msgVistas.add(m.id);
    if (msgPrimeira) continue;
    const text = String(m.text || "") || (m.img ? "📷 Fotografia" : "");
    jobs.push(() => send(code, {title: m.name ? `💬 ${m.name}` : "💬 Nova mensagem", body: text.length > 180 ? text.slice(0, 178) + "…" : text,
      go: "chat", tag: "msg-" + m.id}, m.uid));
  }

  /* Confirmar: marcações que já passaram (cerca de 1 hora depois; sem hora, às 20h do último dia) e
     débitos diretos / entradas automáticas no próprio dia, às 18h. Cada aviso vai uma vez só. */
  const confSent = new Set((st.conf || []).filter((k) => k.slice(-10) >= addDays(now.date, -3)));
  {
    const hm = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
    for (const e of evs) {
      const fim = e.end && e.end > e.date ? e.end : e.date;
      if (fim !== now.date || e.done || e.skip || /^🎒.*(Férias|Feriado)/.test(e.title || "")) continue;
      const desde = e.time && fim === e.date ? hm(e.time) + 60 : 20 * 60;
      if (now.min < desde || now.min > desde + 300) continue;
      const key = `ev|${e.id}|${now.date}`;
      if (confSent.has(key)) continue;
      confSent.add(key);
      jobs.push(() => send(code, {title: `✅ ${e.title}: já está feito?`, body: "Toca para confirmar na app.", go: "inicio", tag: "conf-" + e.id}));
    }
    const mkC = now.date.slice(0, 7), lastC = new Date(Date.UTC(now.y, now.m, 0)).getUTCDate();
    const bs = now.min >= 18 * 60 && now.min < 22 * 60 ? (await db.collection(`households/${code}/bills`).get()).docs.map((x) => ({...x.data(), id: x.id})) : [];
    /* O que entrou: lembra outra vez às 19h se ainda faltar */
    if (now.min >= 19 * 60 && bs.length) {
      const {k: kI, faltam: fI} = entradasFaltam(bs, now), key = `in|${kI}|${now.date}`;
      if (fI.length && !confSent.has(key)) { confSent.add(key);
        jobs.push(() => send(code, {title: "💶 Ainda falta escrever o que entrou", body: fI.map((b) => b.name).join(", "), go: "despesas", tag: "entradas2-" + kI})); }
    }
    /* Contagem: no último dia, se ainda não foi marcada como dada, lembra outra vez ao fim do dia (a partir das 19h) */
    if (now.min >= 19 * 60) for (const b of bs) {
      if (b.kind || !b.rd || Math.min(b.rd, lastC) !== now.d || (b.rdone && b.rdone[mkC])) continue;
      const key = `rd|${b.id}|${now.date}`;
      if (confSent.has(key)) continue;
      confSent.add(key);
      jobs.push(() => send(code, {title: `📟 ${b.name}: hoje é o último dia para dar a contagem`, body: "Já deste? Toca para marcar como dada.", go: "despesas", tag: "contagem-" + b.id}));
    }
    if (mkC >= START && bs.length) {
      for (const b of bs) {
        if ((b.kind && b.kind !== "income") || !b.dd || !b.day || b.acm === "all" || Math.min(b.day, lastC) !== now.d) continue;
        if ((b.paid && b.paid[mkC] != null) || (b.ok && b.ok[mkC])) continue; // já respondido (saiu/não saiu ou marcado à mão)
        const key = `b|${b.id}|${now.date}`;
        if (confSent.has(key)) continue;
        confSent.add(key);
        const inc = b.kind === "income";
        jobs.push(() => send(code, {title: `${inc ? "💶" : "🏦"} ${b.name}: ${inc ? "entrou" : "saiu da conta"}?`,
          body: `${eur(monthAmt(b, mkC))} ${inc ? "deviam ter entrado" : "em débito direto"} hoje. Toca para confirmar na app.`, go: "inicio", tag: "conf-" + b.id}));
      }
    }
  }

  /* Resumo diário: a partir das 9h, uma vez por dia (até às 21h, se o GitHub tiver falhado de manhã). */
  let resumo = st.resumo;
  if (resumo !== now.date && now.min >= 9 * 60 && now.min < 21 * 60) {
    resumo = now.date;
    jobs.push(() => morning(code, now));
  }

  await ref.set({resumo, vistos: [...vistos], lembrados: [...lembrados], meds: [...medsSent], conf: [...confSent], msgs: [...msgVistas], seenB: novosSeenB, buy: compraAgora, at: new Date()});
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
