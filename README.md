# Liturgia Diária API

API autônoma que transforma o site **https://liturgia.cancaonova.com/pb/liturgia/** (Liturgia Diária,
Canção Nova) em JSON estruturado, hospedada no **Cloudflare Pages** com Pages Functions.

## Endpoint

```
GET /api/liturgia?date=YYYY-MM-DD
```

Exemplo:

```
https://<seu-dominio>.pages.dev/api/liturgia?date=2026-11-15
```

### Parâmetro

| Parâmetro | Obrigatório | Formato | Exemplo |
|-----------|-------------|---------|---------|
| `date` | sim | `YYYY-MM-DD` | `2026-11-15` |

### Resposta (exemplo)

```json
{
  "date": "2026-11-15",
  "source_url": "https://liturgia.cancaonova.com/pb/liturgia/33o-domingo-tempo-comum-8/?sDia=15&sMes=11&sAno=2026",
  "weekday": "Domingo",
  "day": 15,
  "month": "Nov",
  "year": 2026,
  "liturgy_color": "Verde",
  "title": "33º Domingo do Tempo Comum",
  "first_reading": {
    "label": "1ª Leitura",
    "reference": "Pr 31,10-13.19-20.30-31",
    "intro": "Leitura do Livro dos Provérbios.",
    "text": "10 Uma mulher forte, quem a encontrará? ...\n- Palavra do Senhor.\n- Graças a Deus."
  },
  "psalm": {
    "label": "Salmo",
    "reference": "Sl 127(128),1-2.3.4-5ab (R. cf. 1a)",
    "intro": null,
    "text": "- Felizes os que temem o Senhor e trilham seus caminhos!\n..."
  },
  "second_reading": {
    "label": "2ª Leitura",
    "reference": "1Ts 5,1-6",
    "intro": "Leitura da Primeira Carta de São Paulo aos Tessalonicenses.",
    "text": "1 Quanto ao tempo e à hora, meus irmãos ..."
  },
  "gospel": {
    "label": "Evangelho",
    "reference": "Mt 25,14-30",
    "intro": null,
    "alleluia": "- Aleluia, Aleluia, Aleluia.\n- Ficai em mim, ...",
    "proclamation": "Proclamação do Evangelho de Jesus Cristo segundo Mateus.",
    "text": "Naquele tempo, Jesus contou esta parábola ..."
  }
}
```

Em dias de semana não há segunda leitura — o campo `second_reading` virá `null`.

### Erros

| Status | Significado |
|--------|-------------|
| 400 | Parâmetro `date` ausente, mal formatado ou data inválida |
| 404 | Liturgia não encontrada para a data (fora do calendário do site) |
| 502 | Falha ao buscar a Canção Nova (site fora do ar ou bloqueio) |

## Como funciona

1. Recebe a data (`YYYY-MM-DD`) e valida.
2. Busca o calendário do mês em `https://liturgia.cancaonova.com/pb/liturgia/?sDia=1&sMes={mes}&sAno={ano}` e extrai o **slug** daquela data (a URL do site depende do título litúrgico do dia).
3. Busca a página da liturgia com o slug encontrado.
4. Faz o parse das seções (`#liturgia-1` a `#liturgia-4`) e devolve o JSON.
5. Resposta é cacheada na borda (1 hora) e no cliente (`stale-while-revalidate`). O calendário mensal fica em cache por 1 dia.

> **Nota:** o slug depende do calendário litúrgico (ex: `33o-domingo-tempo-comum-8`), por isso a API resolve o slug dinamicamente pelo calendário do site em cada request (com cache).

## Hospedagem no Cloudflare Pages (via GitHub)

1. Suba esta pasta `liturgia-api` para um repositório GitHub.
2. No Cloudflare: **Workers & Pages → Create → Pages → Connect to Git** e selecione o repositório.
3. **Build settings**:
   - **Build command**: (deixe vazio)
   - **Build output directory**: `/`
   - **Root directory**: se o repo contém outras pastas, configure como `liturgia-api`
4. Deploy. O endpoint fica em `https://<nome-do-projeto>.pages.dev/api/liturgia?date=2026-11-15`.

### Via Wrangler (linha de comando)

```bash
npm install -g wrangler
cd liturgia-api
wrangler login
wrangler pages deploy .
```

## Deploy como Worker (workers.dev)

Se o seu domínio é `*.workers.dev` (ex: `api-liturgia.mwm-maicon.workers.dev`), o projeto precisa ser publicado como **Worker**, não como Pages. Para isso o repositório já inclui:

- `src/index.js` — entry point do Worker (reaproveita a mesma lógica da Pages Function)
- `wrangler.worker.toml` — configuração com o nome do Worker
- script `npm run deploy:worker`

Basta rodar:

```bash
npx wrangler login          # autentica na sua conta Cloudflare (uma vez)
npm run deploy:worker       # publica o Worker "api-liturgia"
```

Depois, a API fica em:

```
https://api-liturgia.mwm-maicon.workers.dev/api/liturgia?date=2026-11-15
```

> **Pages vs Workers:** `functions/` é usado pelo **Cloudflare Pages** (URL `*.pages.dev`). Para o domínio `*.workers.dev`, use o entry point Worker acima. O código da API é exatamente o mesmo nos dois.

## Exemplo de uso

```bash
curl "https://<seu-dominio>.pages.dev/api/liturgia?date=2026-11-15"
```

Em apps (mobile/web), basta fazer um GET HTTP na URL acima. A resposta é JSON (`content-type: application/json`) e já vem com CORS liberado (`Access-Control-Allow-Origin: *`).
