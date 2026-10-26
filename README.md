# A nossa casa

App para gerir a casa a dois: despensa, carne e peixe, lista de compras, contas e receitas mensais (quanto entra, sai e sobra), calendário e alertas.
Os dados ficam no Firebase Firestore e aparecem logo nos dois telemóveis. A app instala-se no ecrã principal do iPhone,
funciona sem rede e envia notificações.

**Endereço da app:** <https://luis331martins-cyber.github.io/Casa-Martins/> (fica ativo depois do passo 7).

Tudo é gratuito e sem cartão: o Firebase fica no plano **Spark** e as notificações são enviadas pelo **GitHub Actions**.

```
docs/                     ← a app (publicada no GitHub Pages)
  index.html              ← a app
  casa-firebase.js        ← ligação ao Firebase (código da casa, dados, notificações)
  firebase-config.js      ← ⚠️ preenche com os dados do teu projeto Firebase
  sw.js                   ← service worker (funcionamento offline e notificações)
  manifest.json, icons/
notificacoes/index.js     ← envia as notificações (corre no GitHub Actions)
.github/workflows/notificacoes.yml ← agenda: de 15 em 15 minutos
firestore.rules           ← regras de segurança do Firestore
```

## Contas e código da casa

- Cada pessoa entra com **e-mail e palavra-passe** (Firebase Authentication). Há "Esqueci-me da palavra-passe".
- Na primeira vez, cria-se a casa ou escreve-se o **código da casa**; o código fica guardado na conta
  (`users/{uid}`), por isso noutro telemóvel basta entrar com a conta.
- Sessões anónimas de versões anteriores passam a conta sem perder nada (o utilizador mantém-se).
- Para isto funcionar: **Authentication → Método de login → E-mail/senha → Ativar** e as regras de
  [`firestore.rules`](firestore.rules) publicadas no Firestore.

## Como funciona o "código da casa"

- Cada telemóvel entra no Firebase com **autenticação anónima** (sem email nem palavra-passe).
- O primeiro telemóvel toca em **Criar casa nova** e recebe um código como `ZX5Y-QEFE-NURZ`.
  O que já estiver guardado nesse telemóvel passa para a casa.
- No segundo telemóvel escreve-se esse código uma vez e toca-se em **Entrar**.
- Os dados ficam em `households/{código}/items`, `.../bills` e `.../events`, com os mesmos campos de antes.
- As regras do Firestore só deixam ler e escrever a quem se registou nessa casa com o código.
  Não é possível listar casas, por isso o código funciona como uma chave: **não o publiques**.
  Com 12 caracteres aleatórios é impossível de adivinhar.

---

## Passo a passo (o que tens de fazer manualmente)

Só precisas do browser e da tua conta Google. Não é preciso instalar nada no computador.

### 1. Criar o projeto no Firebase

1. Abre <https://console.firebase.google.com> e toca em **Criar um projeto**.
2. Nome: por exemplo `casa-martins`.
3. O Google Analytics não é preciso: podes desativá-lo.
4. O projeto fica no plano **Spark (gratuito)**. Não mudes de plano nem associes cartão.

### 2. Registar a app Web e copiar a configuração

1. Na página inicial do projeto, toca no ícone **`</>`** (Web).
2. Alcunha: `Casa`. **Não** marques o Firebase Hosting. Toca em **Registar app**.
3. Aparece um bloco `const firebaseConfig = { ... }`. Copia esses valores para
   [`docs/firebase-config.js`](docs/firebase-config.js) (`apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`). No GitHub, abre o ficheiro e usa o lápis ✏️ para o editar.
   Estes valores não são secretos; quem protege os dados são as regras do Firestore.

### 3. Ativar a autenticação anónima

1. Menu **Criação → Authentication → Começar**.
2. Separador **Método de início de sessão → Anónimo → Ativar → Guardar**.
3. Separador **Definições → Domínios autorizados → Adicionar domínio**: `luis331martins-cyber.github.io`.

### 4. Criar a base de dados Firestore e publicar as regras

1. Menu **Criação → Firestore Database → Criar base de dados**.
2. Edição **Standard**, localização **`europe-west1` (Bélgica)** (ou outra na Europa).
3. Começa em **modo de produção**.
4. Separador **Regras**: apaga o que lá está, cola todo o conteúdo de [`firestore.rules`](firestore.rules)
   e toca em **Publicar**.

### 5. Ativar o Cloud Messaging (notificações)

1. Engrenagem ⚙️ → **Definições do projeto → Cloud Messaging**.
2. Confirma que a **API Firebase Cloud Messaging (V1)** está **Ativada**.
3. Em baixo, **Configuração Web → Certificados push da Web → Gerar par de chaves**.
4. Copia a chave (começa por `B...`) para `self.FIREBASE_VAPID_KEY` em [`docs/firebase-config.js`](docs/firebase-config.js).

### 6. Dar ao GitHub a chave para enviar notificações

O GitHub precisa de uma chave da conta de serviço do Firebase para ler a agenda, as contas e as validades, e para
enviar as notificações.

1. Firebase: engrenagem ⚙️ → **Definições do projeto → Contas de serviço → Gerar nova chave privada → Gerar chave**.
   Descarrega um ficheiro `.json`. **Esta chave é secreta**: dá acesso total ao projeto. Não a envies a ninguém
   nem a ponhas no código.
2. GitHub: no repositório, **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT`
   - Secret: abre o ficheiro `.json` num editor de texto, copia **todo** o conteúdo e cola aqui.
   - **Add secret**.
3. Apaga o ficheiro `.json` do computador.

Os segredos do GitHub ficam encriptados e não aparecem a ninguém, mesmo com o repositório público.

### 7. Publicar a app no GitHub Pages

1. O GitHub Pages grátis só funciona em repositórios **públicos**: **Settings → General → Danger Zone →
   Change visibility → Public**. Não há nada secreto no repositório: os dados estão no Firebase, a chave está nos
   segredos e o código da casa não fica no GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch →
   Branch: `claude/app-casa-firebase-pwa-y2ehpo`, pasta `/docs` → Save**.
3. Ao fim de 1–2 minutos a app fica em **<https://luis331martins-cyber.github.io/Casa-Martins/>**.
4. Separador **Actions**: se aparecer um aviso, toca em **I understand my workflows, go ahead and enable them**.
   Para testar já, abre **Notificações → Run workflow**. Deve ficar com um visto verde ✅.

Sempre que mudares `docs/firebase-config.js` ou outro ficheiro da app, sobe a versão em
[`docs/sw.js`](docs/sw.js) (`casa-v1` → `casa-v2`) para os telemóveis irem buscar a versão nova.

### 8. Instalar nos dois iPhones

**No teu telemóvel**

1. Abre <https://luis331martins-cyber.github.io/Casa-Martins/> no **Safari**.
2. **Partilhar** (quadrado com a seta) → **Adicionar ao ecrã principal** → **Adicionar**.
3. Abre a app **pelo ícone "Casa"** no ecrã principal.
4. Toca em **Criar casa nova**. Aparece o código no ecrã **⚙️ Esta casa** (botão ⚙️ no canto do Início). Toca em **Partilhar** para o enviar à tua esposa.
5. Em **Notificações**, toca em **Ativar** e aceita.

**No telemóvel da tua esposa**

1. Os mesmos passos 1 a 3.
2. Escreve o código da casa e toca em **Entrar** (maiúsculas, espaços e traços não importam).
3. Em **Notificações**, toca em **Ativar** e aceita.

---

## Notificações

O GitHub Actions corre [`notificacoes/index.js`](notificacoes/index.js) de 15 em 15 minutos e decide o que enviar:

| Quando | O quê |
|---|---|
| A partir das 9h (hora de Lisboa), uma vez por dia | **Contas a pagar**: atrasadas, a vencer hoje e nos próximos 3 dias (as que ainda não estão marcadas como pagas) |
| A partir das 9h, uma vez por dia | **Validades a terminar**: produtos que terminam nos próximos 3 dias ou já passaram do prazo |
| A partir das 9h, uma vez por dia | **Resumo**: marcações de hoje e de amanhã e quantos produtos há para comprar |
| Cerca de 1 hora antes | **Lembrete** de cada marcação com hora |
| Até ~15 min depois de alguém marcar algo | **Nova marcação** no outro telemóvel (quem marcou não recebe) |

Se não houver nada para dizer, a notificação desse tipo não é enviada.
Tocar numa notificação abre a app no separador certo (Contas, Despensa, Calendário ou Compras).

### Limites do GitHub Actions

- O GitHub não garante a hora exata: com muito movimento, uma execução pode atrasar alguns minutos ou falhar.
  O resumo das 9h pode chegar às 9h10 ou 9h20; se a execução das 9h falhar, sai na seguinte (até às 21h).
- Os lembretes saem entre ~60 e ~75 minutos antes da marcação.
- Em repositórios públicos, o GitHub pode desligar os agendamentos quando não há atividade há 60 dias. O workflow
  tenta manter-se ligado sozinho; se mesmo assim for desligado, recebes um email do GitHub e voltas a ligá-lo em
  **Actions → Notificações → Enable workflow**.
- Os registos do Actions são públicos, por isso o script não escreve neles o código da casa nem o conteúdo das notificações.

### Limites do iPhone

- **iOS/iPadOS 16.4 ou mais recente.** Em versões anteriores, as apps Web não recebem notificações.
- **Só com a app no ecrã principal.** No separador normal do Safari não há notificações; a app avisa disso no ecrã
  **⚙️ Esta casa**. Usa o Safari para a adicionar.
- **A permissão só pode ser pedida depois de um toque** (por isso há o botão **Ativar**). Se tocares em "Não permitir",
  só se volta a ativar em **Definições → Notificações → Casa**.
- **Cada telemóvel ativa as suas.** O código da casa partilha os dados, não as notificações.
- **Se apagares a app do ecrã principal**, perdes o registo de notificações e os dados guardados nesse telemóvel
  (os da casa continuam no Firebase): volta a adicioná-la e a escrever o código.
- **Não há sons personalizados** e as notificações podem chegar com atraso se o telemóvel estiver em poupança de
  energia ou em modo Foco.
- As notificações chegam mesmo com a app fechada, mas o telemóvel precisa de internet para as receber.

## Funcionamento sem rede

- A app fica guardada no telemóvel pelo service worker e abre mesmo sem internet.
- O Firestore guarda uma cópia dos dados no telemóvel. O que mudares sem rede aparece logo e é enviado quando a ligação voltar.
- Para entrar numa casa pela primeira vez é preciso internet.

## Usar sem Firebase

Enquanto `apiKey` estiver vazio em `docs/firebase-config.js`, a app funciona como antes: tudo guardado só neste aparelho
(localStorage). Também é possível escolher **Usar só neste aparelho** no ecrã do código e partilhar mais tarde.

## Sair de uma casa

**⚙️ (no Início) → Sair desta casa neste telemóvel.** O telemóvel deixa de ter acesso e de receber notificações.
Os dados continuam no Firebase para quem tem o código.

## Para programadores (opcional)

`firebase.json` e `.firebaserc` permitem publicar as regras pela linha de comandos
(`firebase deploy --only firestore:rules`) e testar com os emuladores (`firebase emulators:start`).
Com `self.FIREBASE_EMULATORS = true` em `docs/firebase-config.js`, a app liga-se aos emuladores locais.
