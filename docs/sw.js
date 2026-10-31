/* Service worker: guarda a app para funcionar sem rede e mostra as notificações push.
   Ao mudar ficheiros da app, sobe a versão para os telemóveis irem buscar a nova. */
const VERSION="casa-v202";
const SHELL=["./","index.html","casa-firebase.js","firebase-config.js","manifest.json",
  "icons/casam.svg","icons/casam-180.png","icons/casam-192.png","icons/casam-512.png",
  ...["despensa","carne","lista","comer","plano","despesas","creditos","cartoes","poupancas","docs","meds","saude","carro","videos","jogos","gear","anos","escola","viagens","casa"].map(n=>`icons/3d/${n}.webp`)];
const SDK=["app","auth","firestore","messaging"].map(n=>`https://www.gstatic.com/firebasejs/12.19.0/firebase-${n}.js`);
/* Bibliotecas (Firebase, letras, leitor de PDF, leitor de fotografias): têm a versão no endereço, não mudam */
const CDN=["https://www.gstatic.com","https://fonts.googleapis.com","https://fonts.gstatic.com","https://cdn.jsdelivr.net","https://cdnjs.cloudflare.com"];

self.addEventListener("install",e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(VERSION);
    await c.addAll(SHELL);
    await Promise.all(SDK.map(u=>c.add(u).catch(()=>{})));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate",e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys())if(k!==VERSION)await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch",e=>{
  const r=e.request, u=new URL(r.url);
  if(r.method!=="GET")return;
  /* "?v=hora": pedido para ver se há versão nova; vai sempre à rede, sem cópia guardada */
  if(u.origin===location.origin&&u.searchParams.has("v")&&r.mode!=="navigate")return;
  /* Página: rede primeiro (para apanhar atualizações), cópia guardada se não houver rede */
  if(r.mode==="navigate"){
    e.respondWith(fetch(r).then(res=>{const copy=res.clone();caches.open(VERSION).then(c=>c.put("index.html",copy));return res})
      .catch(()=>caches.match("index.html")));
    return;
  }
  /* Ficheiros da app: responde com a cópia e atualiza em segundo plano */
  if(u.origin===location.origin){
    e.respondWith(caches.open(VERSION).then(async c=>{
      const hit=await c.match(r,{ignoreSearch:true});
      const net=fetch(r).then(res=>{if(res.ok)c.put(r,res.clone());return res});
      if(hit){e.waitUntil(net.catch(()=>{}));return hit}
      return net;
    }));
    return;
  }
  /* SDK do Firebase e tipos de letra: não mudam, guarda à primeira */
  if(CDN.includes(u.origin)){
    e.respondWith(caches.open(VERSION).then(async c=>{
      const hit=await c.match(r);if(hit)return hit;
      const res=await fetch(r);if(res.ok||res.type==="opaque")c.put(r,res.clone());return res;
    }));
  }
  /* Tudo o resto (Firestore, autenticação) vai direto à rede; o Firestore tem a sua própria cache */
});

/* ---------- notificações push (Firebase Cloud Messaging) ----------
   A Cloud Function envia mensagens só com "data" (title, body, link, tag) e é aqui que se mostram.
   No iPhone, cada push tem de mostrar uma notificação, senão o iOS deixa de as entregar. */
self.addEventListener("push",e=>{
  let p={};try{p=e.data?e.data.json():{}}catch(err){p={data:{body:e.data&&e.data.text()}}}
  const d=p.data||{}, n=p.notification||{};
  const title=d.title||n.title||"Casa";
  e.waitUntil(self.registration.showNotification(title,{
    body:d.body||n.body||"",
    tag:d.tag||undefined,
    icon:"icons/casam-192.png",
    badge:"icons/casam-192.png",
    data:{link:d.link||(p.fcmOptions&&p.fcmOptions.link)||"./",k:d.k||""},
    /* Toma de medicamento: botão "Tomei" (Android e computador; o iPhone não mostra botões e pergunta na app) */
    ...(d.k?{actions:[{action:"tomei",title:"✓ Tomei"}]}:{})
  }));
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  const k=e.notification.data&&e.notification.data.k;
  const link=e.action==="tomei"&&k?new URL("./#tomei:"+encodeURIComponent(k),self.registration.scope).href:new URL(e.notification.data&&e.notification.data.link||"./",self.registration.scope).href;
  const go=new URL(link).hash.slice(1);
  e.waitUntil((async()=>{
    const all=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const c=all.find(w=>w.url.startsWith(self.registration.scope));
    if(c){await c.focus();if(go)c.postMessage({go});return}
    await self.clients.openWindow(link);
  })());
});
