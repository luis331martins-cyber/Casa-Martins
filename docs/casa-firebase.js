/* Ligação ao Firebase: contas com e-mail e palavra-passe, casa partilhada por código e notificações.
   Os dados ficam em households/{código}/items|bills|events; o código de cada pessoa fica em users/{uid}. */
import {initializeApp} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {getAuth,connectAuthEmulator,createUserWithEmailAndPassword,signInWithEmailAndPassword,signOut,sendPasswordResetEmail,
  EmailAuthProvider,linkWithCredential,updateProfile,reauthenticateWithCredential,updatePassword} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,connectFirestoreEmulator,
  doc,collection,setDoc,deleteDoc,getDoc,getDocFromCache,getDocsFromServer,onSnapshot,serverTimestamp,writeBatch} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const app=initializeApp(self.FIREBASE_CONFIG);
const auth=getAuth(app);
auth.useDeviceLanguage(); // e-mails (ex.: repor a palavra-passe) em português
/* Cache local em IndexedDB: a app abre e funciona sem rede; as alterações sincronizam quando voltar. */
const db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
if(self.FIREBASE_EMULATORS){connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});connectFirestoreEmulator(db,"127.0.0.1",8080)}

/* ---------- código da casa ---------- */
const ABC="ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCode(){const r=crypto.getRandomValues(new Uint8Array(12));return Array.from(r,x=>ABC[x%ABC.length]).join("")}

/* ---------- conta ---------- */
/* Só contas com e-mail têm acesso; as sessões anónimas antigas passam a conta com signUp (mantém o mesmo uid) */
async function user(){await auth.authStateReady();const u=auth.currentUser;
  if(!u||u.isAnonymous)throw Object.assign(new Error("Sem sessão iniciada"),{code:"auth/no-session"});return u}
export async function me(){return(await user()).uid}
export async function account(){await auth.authStateReady();const u=auth.currentUser;
  return u?{uid:u.uid,email:u.email||"",anon:u.isAnonymous,name:u.displayName||""}:null}
export async function signUp(email,pass,name){
  await auth.authStateReady();let u=auth.currentUser;
  if(u&&u.isAnonymous)u=(await linkWithCredential(u,EmailAuthProvider.credential(email,pass))).user;
  else u=(await createUserWithEmailAndPassword(auth,email,pass)).user;
  if(name)await updateProfile(u,{displayName:name}).catch(()=>{});
  await u.getIdToken(true);
  return account();
}
export async function signIn(email,pass){await signInWithEmailAndPassword(auth,email,pass);return account()}
export async function logout(){await signOut(auth)}
export async function resetPass(email){await sendPasswordResetEmail(auth,email)}
/* Mudar o PIN: confirma o PIN atual e grava o novo */
export async function changePass(oldPass,newPass){const u=await user();
  await reauthenticateWithCredential(u,EmailAuthProvider.credential(u.email,oldPass));await updatePassword(u,newPass)}
/* Código da casa guardado na conta: ao entrar noutro telemóvel não é preciso escrevê-lo */
export async function myCode(){const u=await user();const s=await getDoc(doc(db,"users",u.uid));return s.exists()?(s.get("code")||""):""}
export async function saveMyCode(code,name){const u=await user();const ref=doc(db,"users",u.uid);
  if(!code)return deleteDoc(ref);return setDoc(ref,{code,name:name||"",updated:serverTimestamp()})}

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
  try{await deleteDoc(doc(db,"users",u.uid))}catch(e){}
}

/* Mesma interface que window.claude.use("db"): collection(n).doc(id).set/delete e collection(n).onSnapshot. */
export function store(code){
  const col=n=>collection(db,"households",code,n);
  return{collection:n=>({
    doc:id=>({set:d=>setDoc(doc(col(n),id),d),delete:()=>deleteDoc(doc(col(n),id))}),
    onSnapshot:(ok,err)=>onSnapshot(col(n),ok,err)
  })};
}

/* Lê a coleção diretamente do servidor (não da cópia no telemóvel): para decidir com a certeza do que já existe. */
export async function fromServer(code,n){const q=await getDocsFromServer(collection(db,"households",code,n));return q.docs.map(d=>({...d.data(),id:d.id}))}

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
