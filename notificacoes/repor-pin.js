/* Repor o PIN de uma conta: gera um PIN temporário de 6 números e envia-o por notificação aos telemóveis da casa dessa pessoa.
   Corre no GitHub Actions (Actions → Repor PIN → Run workflow). Os registos do Actions são públicos:
   este script NUNCA escreve o PIN nem o código da casa nos registos. */
const crypto = require("crypto");
const {initializeApp, cert} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
const APP_URL = process.env.APP_URL;
const USER = String(process.env.UTILIZADOR || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, ".");

(async () => {
  if (!/^[a-z0-9][a-z0-9._-]{1,19}$/.test(USER)) throw new Error("Nome de utilizador inválido.");
  initializeApp(SA ? {credential: cert(JSON.parse(SA))} : undefined);
  const auth = getAuth(), db = getFirestore();
  let u;
  try {
    u = await auth.getUserByEmail(`${USER}@casa-martins.invalid`);
  } catch (e) {
    throw new Error(`Não há nenhuma conta "${USER}".`);
  }
  const casa = await db.doc(`users/${u.uid}`).get();
  const code = casa.exists ? casa.get("code") : "";
  if (!code) throw new Error("Esta conta ainda não tem casa; não há para onde enviar o PIN.");
  const tokens = (await db.collection(`households/${code}/tokens`).get()).docs.map((d) => d.get("token")).filter(Boolean);
  if (!tokens.length) throw new Error("Nenhum telemóvel da casa tem as notificações ativas; não há para onde enviar o PIN.");
  const pin = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await auth.updateUser(u.uid, {password: pin});
  const res = await getMessaging().sendEach(tokens.map((token) => ({
    token,
    data: {title: `🔑 PIN temporário de ${USER}`, body: `${pin} — entra com este PIN e muda-o na ⚙️ (Mudar PIN).`, link: new URL("#definicoes", APP_URL).toString(), tag: "pin"},
    webpush: {headers: {Urgency: "high", TTL: "3600"}},
  })));
  const ok = res.responses.filter((r) => r.success).length;
  console.log(`PIN de "${USER}" reposto; notificação enviada para ${ok} de ${tokens.length} telemóvel(is).`);
  if (!ok) throw new Error("A notificação não chegou a nenhum telemóvel. Corre outra vez mais tarde.");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
