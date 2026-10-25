/* Ligação ao Firebase: autenticação anónima, casa partilhada por código e notificações.
   Os dados ficam em households/{código}/items|bills|events. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth,signInAnonymously,connectAuthEmulator} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,connectFirestoreEmulator,
  doc,collection,setDoc,deleteDoc,getDoc,getDocFromCache,onSnapshot,serverTimestamp,writeBatch} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app=initializeApp(self.FIREBASE_CONFIG);
const auth=getAuth(app);
/* Cache local em IndexedDB: a app abre e funciona sem rede; as alterações sincronizam quando voltar. */
const db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
if(self.FIREBASE_EMULATORS){connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});connectFirestoreEmulator(db,"127.0.0.1",8080)}

/* ---------- código da casa ---------- */
const ABC="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCode(){const r=crypto.getRandomValues(new Uint8Array(12));return Array.from(r,x=>ABC[x%ABC.length]).join("")}

async function user(){await auth.authStateReady();return auth.currentUser||(await signInAnonymously(auth)).user}
export async function me(){return(await user()).uid}

/* Entra numa casa que já existe. Falha com "permission-denied" se o código não existir. */
export async function join(code){
  const u=await user(), ref=doc(db,"households",code,"members",u.uid);
  try{if((await getDocFromCache(ref)).exists())return}catch(e){}
  if((await getDoc(ref)).exists())return;
  await setDoc(ref,{joined:serverTimestamp()});
}

/* Cria uma casa nova com um código aleatório e copia para lá o que já estava guardado neste aparelho. */
export async function create(seed){
  const u=await user();
  for(let n=0;;n++){
    const code=newCode();
    try{await setDoc(doc(db,"households",code),{created:serverTimestamp(),by:u.uid})}
    catch(e){if(e.code==="permission-denied"&&n<3)continue;throw e}
    await join(code);
    const b=writeBatch(db);let k=0;
    for(const [name,list] of Object.entries(seed||{}))for(const d of list){if(d&&d.id){b.set(doc(db,"households",code,name,d.id),d);k++}}
    if(k)await b.commit();
    return code;
  }
}

/* Sai da casa neste aparelho: deixa de receber notificações e perde o acesso. */
export async function leave(code){
  const u=await user();
  try{await deleteDoc(doc(db,"households",code,"tokens",u.uid))}catch(e){}
  try{await deleteDoc(doc(db,"households",code,"members",u.uid))}catch(e){}
}

/* Mesma interface que window.claude.use("db"): collection(n).doc(id).set/delete e collection(n).onSnapshot. */
export function store(code){
  const col=n=>collection(db,"households",code,n);
  return{collection:n=>({
    doc:id=>({set:d=>setDoc(doc(col(n),id),d),delete:()=>deleteDoc(doc(col(n),id))}),
    onSnapshot:(ok,err)=>onSnapshot(col(n),ok,err)
  })};
}

/* ---------- notificações (Firebase Cloud Messaging) ---------- */
export async function pushSupported(){
  if(!self.FIREBASE_VAPID_KEY)return false;
  try{const m=await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js");return await m.isSupported()}catch(e){return false}
}
/* Pede o token deste aparelho e guarda-o em households/{código}/tokens/{uid}. */
export async function enablePush(code,reg){
  const {getMessaging,getToken}=await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging.js");
  const token=await getToken(getMessaging(app),{vapidKey:self.FIREBASE_VAPID_KEY,serviceWorkerRegistration:reg});
  if(!token)throw new Error("sem-token");
  const u=await user();
  await setDoc(doc(db,"households",code,"tokens",u.uid),{token,updated:serverTimestamp(),ua:navigator.userAgent.slice(0,200)});
  return token;
}
