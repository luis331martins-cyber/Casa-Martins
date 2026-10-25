# A nossa casa

App para gerir a casa a dois: despensa, carne e peixe, lista de compras, despesas mensais, calendário e alertas.
Os dados ficam no Firebase Firestore e aparecem logo nos dois telemóveis. A app instala-se no ecrã principal do iPhone,
funciona sem rede e envia notificações.

```
docs/                 ← a app (publicada no GitHub Pages)
  index.html          ← a app
  casa-firebase.js    ← ligação ao Firebase (código da casa, dados, notificações)
  firebase-config.js  ← ⚠️ preenche com os dados do teu projeto Firebase
  sw.js               ← service worker (funcionamento offline e notificações)
  manifest.json, icons/
functions/index.js    ← Cloud Functions: resumo às 9h, contas, validades, marcações
firestore.rules       ← regras de segurança do Firestore
firebase.json, .firebaserc
```

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

Precisas de: um computador com [Node.js 22](https://nodejs.org) e a tua conta Google.

### 1. Criar o projeto no Firebase

1. Abre <https://console.firebase.google.com> e toca em **Criar um projeto**.
2. Nome: por exemplo `casa-martins`. Anota o **ID do projeto** que aparece por baixo (ex.: `casa-martins-1a2b3`).
3. O Google Analytics não é preciso: podes desativá-lo.

### 2. Registar a app Web e copiar a configuração

1. Na página inicial do projeto, toca no ícone **`</>`** (Web).
2. Alcunha: `Casa`. **Não** marques o Firebase Hosting. Toca em **Registar app**.
3. Aparece um bloco `const firebaseConfig = { ... }`. Copia esses valores para
   [`docs/firebase-config.js`](docs/firebase-config.js) (`apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`).
   Estes valores não são secretos; quem protege os dados são as regras do Firestore.
4. Em [`.firebaserc`](.firebaserc), troca `ID-DO-TEU-PROJETO` pelo ID do projeto.

### 3. Ativar a autenticação anónima

1. Menu **Criação → Authentication → Começar**.
2. Separador **Método de início de sessão → Anónimo → Ativar → Guardar**.
3. Separador **Definições → Domínios autorizados → Adicionar domínio**: `luis331martins-cyber.github.io`.

### 4. Criar a base de dados Firestore

1. Menu **Criação → Firestore Database → Criar base de dados**.
2. Edição **Standard**.
3. Localização: **`europe-west1` (Bélgica)**. Tem de ser esta, porque é a região das Cloud Functions
   ([`functions/index.js`](functions/index.js)). Se escolheres outra, muda `region` nesse ficheiro para a mesma.
4. Começa em **modo de produção** (tudo fechado). As regras certas são publicadas no passo 7.

### 5. Ativar o Cloud Messaging (notificações)

1. Engrenagem ⚙️ → **Definições do projeto → Cloud Messaging**.
2. Confirma que a **API Firebase Cloud Messaging (V1)** está **Ativada**.
3. Em baixo, **Configuração Web → Certificados push da Web → Gerar par de chaves**.
4. Copia a chave (começa por `B...`) para `self.FIREBASE_VAPID_KEY` em [`docs/firebase-config.js`](docs/firebase-config.js).

### 6. Passar para o plano Blaze (necessário para as Cloud Functions)

As funções agendadas (resumo às 9h e lembretes) só funcionam no plano **Blaze** (pagar consoante o uso).
Para uma casa com dois telemóveis o uso fica muito abaixo das quotas gratuitas, por isso o custo esperado é **0 €**.

1. No canto inferior esquerdo da consola: **Atualizar → Blaze** e associa um cartão.
2. Por segurança, cria um **alerta de orçamento** de 1 € (a consola sugere-o ao mudar de plano).

O que se usa por mês: ~3 000 execuções de funções (gratuito até 2 milhões), 2 tarefas do Cloud Scheduler (3 grátis),
leituras do Firestore muito abaixo das 50 000 grátis por dia. As notificações FCM são gratuitas.

### 7. Publicar as regras e as Cloud Functions

No computador, na pasta do repositório:

```bash
npm install -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,functions
```

Na primeira vez pergunta o valor de **`APP_URL`**: escreve `https://luis331martins-cyber.github.io/Casa-Martins/`
(é para onde a notificação te leva quando tocas nela). Fica guardado em `functions/.env.<id-do-projeto>`.

Se aparecer um erro a pedir para ativar APIs (Cloud Build, Artifact Registry, Cloud Scheduler, Eventarc),
espera um minuto e repete o comando: o Firebase ativa-as na primeira publicação.

Para ver se correu bem: consola → **Functions** deve mostrar `resumoDiario`, `lembretesMarcacoes` e `novaMarcacao`.

### 8. Publicar a app no GitHub Pages

1. Junta este ramo ao `main`: no GitHub abre um pull request de `claude/app-casa-firebase-pwa-y2ehpo` para `main` e faz merge.
   Se o repositório ainda não tiver `main`: **Code → Branches → New branch**, nome `main`, a partir de
   `claude/app-casa-firebase-pwa-y2ehpo`; depois **Settings → General → Default branch → main**.
2. O GitHub Pages grátis só funciona em repositórios **públicos**: **Settings → General → Danger Zone →
   Change visibility → Public**. Não há nada secreto no repositório (os dados estão no Firebase e o código da casa
   não fica no GitHub).
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, pasta `/docs` → Save**.
4. Ao fim de 1–2 minutos a app fica em **<https://luis331martins-cyber.github.io/Casa-Martins/>**.

Sempre que mudares `docs/firebase-config.js` ou outro ficheiro da app, sobe a versão em
[`docs/sw.js`](docs/sw.js) (`casa-v1` → `casa-v2`) para os telemóveis irem buscar a versão nova.

### 9. Instalar nos dois iPhones

**No teu telemóvel**

1. Abre o endereço da app no **Safari**.
2. **Partilhar** (quadrado com a seta) → **Adicionar ao ecrã principal** → **Adicionar**.
3. Abre a app **pelo ícone "Casa"** no ecrã principal.
4. Toca em **Criar casa nova**. Aparece o código em **Início → Esta casa**. Toca em **Partilhar** para o enviar à tua esposa.
5. Em **Notificações**, toca em **Ativar** e aceita.

**No telemóvel da tua esposa**

1. Os mesmos passos 1 a 3.
2. Escreve o código da casa e toca em **Entrar** (maiúsculas, espaços e traços não importam).
3. Em **Notificações**, toca em **Ativar** e aceita.

---

## Notificações

| Quando | O quê |
|---|---|
| Todos os dias às 9h (hora de Lisboa) | **Contas a pagar**: atrasadas, a vencer hoje e nos próximos 3 dias (as que ainda não estão marcadas como pagas) |
| Todos os dias às 9h | **Validades a terminar**: produtos que terminam nos próximos 3 dias ou já passaram do prazo |
| Todos os dias às 9h | **Resumo**: marcações de hoje e de amanhã e quantos produtos há para comprar |
| Cerca de 1 hora antes | **Lembrete** de cada marcação com hora (verificado de 15 em 15 minutos, por isso chega entre 45 e 60 min antes) |
| Quando alguém marca algo | **Nova marcação** no outro telemóvel (quem marcou não recebe) |

Se não houver nada para dizer, a notificação desse tipo não é enviada.
Tocar numa notificação abre a app no separador certo (Despesas, Despensa, Calendário ou Compras).

### Limites do iPhone

- **iOS/iPadOS 16.4 ou mais recente.** Em versões anteriores, as apps Web não recebem notificações.
- **Só com a app no ecrã principal.** No separador normal do Safari não há notificações; a app avisa disso em
  **Início → Esta casa**. Usa o Safari para a adicionar (é o caminho mais fiável).
- **A permissão só pode ser pedida depois de um toque** (por isso há o botão **Ativar**). Se tocares em "Não permitir",
  só se volta a ativar em **Definições → Notificações → Casa**.
- **Cada telemóvel ativa as suas.** O código da casa partilha os dados, não as notificações.
- **Se apagares a app do ecrã principal**, perdes o registo de notificações e os dados guardados nesse telemóvel
  (os da casa continuam no Firebase): volta a adicioná-la e a escrever o código.
- **Não há sons nem badges personalizados** e as notificações podem chegar com algum atraso se o telemóvel estiver em
  poupança de energia ou em modo Foco.
- O resumo e os lembretes vêm do servidor, por isso chegam mesmo com a app fechada. O que não se consegue é o iPhone
  avisar sozinho sem internet: as notificações precisam de rede.

## Funcionamento sem rede

- A app fica guardada no telemóvel pelo service worker e abre mesmo sem internet.
- O Firestore guarda uma cópia dos dados no telemóvel. O que mudares sem rede aparece logo e é enviado quando a ligação voltar.
- Para entrar numa casa pela primeira vez é preciso internet.

## Usar sem Firebase

Enquanto `apiKey` estiver vazio em `docs/firebase-config.js`, a app funciona como antes: tudo guardado só neste aparelho
(localStorage). Também é possível escolher **Usar só neste aparelho** no ecrã do código e partilhar mais tarde.

## Sair de uma casa

**Início → Esta casa → Sair desta casa neste telemóvel.** O telemóvel deixa de ter acesso e de receber notificações.
Os dados continuam no Firebase para quem tem o código.
