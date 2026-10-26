/* Publica ../firestore.rules no Firestore do projeto (corre no GitHub Actions com a conta de serviço). */
const fs = require("fs");
const path = require("path");
const {initializeApp, cert} = require("firebase-admin/app");
const {getSecurityRules} = require("firebase-admin/security-rules");

(async () => {
  const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!SA) throw new Error("Falta o segredo FIREBASE_SERVICE_ACCOUNT.");
  initializeApp({credential: cert(JSON.parse(SA))});
  const src = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
  const rs = await getSecurityRules().releaseFirestoreRulesetFromSource(src);
  console.log(`Regras publicadas (${rs.name.split("/").pop()}, ${rs.createTime}).`);
})().catch((e) => {
  console.error("Falhou:", e.message);
  process.exit(1);
});
