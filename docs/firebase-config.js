/* Configuração do Firebase.
   Copia os valores de: Consola Firebase → Definições do projeto → Geral → As tuas apps → App Web.
   Estes valores não são secretos: quem protege os dados são as regras do Firestore.
   Enquanto apiKey estiver vazio, a app funciona só neste aparelho (localStorage). */
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDWHdg-oDKxajewRlQa1IYJrvVOhrxJeqs",
  authDomain: "casa-martins-a983d.firebaseapp.com",
  projectId: "casa-martins-a983d",
  storageBucket: "casa-martins-a983d.firebasestorage.app",
  messagingSenderId: "26519856939",
  appId: "1:26519856939:web:16e774cf78801e3078c76e"
};

/* Cloud Messaging → Certificados push da Web → par de chaves (chave pública). */
self.FIREBASE_VAPID_KEY = "BLjM7SMIN_7PVaRJrPp98OmxKZOqq8rjuM7h51bbc0JqC4iEIc6kZBdQRICS2cahca9SSyHka50ArkJnUIEVZDg";

/* Chave da YouTube Data API v3 para procurar vídeos dentro da app (Google Cloud → Credenciais).
   Restringida ao site da app e à YouTube Data API. Vazia: o botão Procurar abre o YouTube. */
self.YOUTUBE_KEY = "";
