/* Configuração do Firebase.
   Copia os valores de: Consola Firebase → Definições do projeto → Geral → As tuas apps → App Web.
   Estes valores não são secretos: quem protege os dados são as regras do Firestore.
   Enquanto apiKey estiver vazio, a app funciona só neste aparelho (localStorage). */
self.FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

/* Cloud Messaging → Certificados push da Web → par de chaves (chave pública). */
self.FIREBASE_VAPID_KEY = "";
