# Mijn Nieuws

Persoonlijke nieuws-app in de stijl van Google News (mobiel): kaartjes met plaatje, kop en bron,
tik voor het volledige artikel. De app **leert van wat je aanklikt**: bronnen en onderwerpen die je
vaker opent komen hoger te staan. Engelse artikelen worden **naar het Nederlands vertaald**.

- **Frontend**: statische PWA (installeerbaar op je telefoon) in `web/`, gehost op GitHub Pages:
  https://skoers.github.io/News/
- **Backend**: Cloudflare Worker in `worker/` (`https://mijn-nieuws-api.skoers.workers.dev`), die
  RSS-feeds ophaalt, artikelen uitleest en vertaalt met Workers AI.

## Hoe het leert

Alles wordt lokaal op je toestel bewaard (`localStorage`, geen account). Bij elke klik:

| Signaal | Gewicht |
|---|---|
| Artikel openen | bron +1, rubriek +0,6, trefwoorden uit kop +0,5 |
| Volledig artikel lezen | nogmaals ×1,5 |
| Verval | halfwaardetijd 21 dagen, zodat oude interesses langzaam wegzakken |

Score per artikel = versheid × (1 + 0,8·log(bron) + 0,4·log(rubriek) + 1,2·log(onderwerpen)), met een
diversiteitsregel (max. 2 artikelen van dezelfde bron per 6 posities). Onderwerpen met een hoge score
verschijnen automatisch als extra tab (✦). Via Instellingen zie je je profiel en kun je het exporteren,
importeren of wissen.

## Vertalen en kosten

- **Koppen** worden in batches vertaald en 7 dagen gecachet: verwaarloosbaar.
- **Volledig artikel**: Workers AI (Mistral Small) in de Worker. Het gratis dagquotum (10.000 neurons)
  is goed voor ±160 vertaalde artikelen per dag; daarboven kost een artikel ongeveer €0,0007.
- Alternatief, helemaal gratis: instelling *Volledig artikel vertalen via Google Translate* opent de
  vertaalde site in de browser.
- Betaalmuren (bijv. FD) worden herkend; zo'n artikel krijgt een knop **Open via archive.is**.
  Bij een eigen bron kun je dit aanvinken bij het toevoegen.

Er worden geen API-sleutels van OpenAI/Gemini/Anthropic gebruikt.

## Deployen

### Frontend
Elke push naar `main` die `web/` raakt publiceert via GitHub Actions naar GitHub Pages
(`.github/workflows/pages.yml`). Pas het API-adres aan in `web/config.js` of in de app onder
Instellingen → Backend.

### Worker
```bash
cd worker
npm install
npm test            # unit-tests (Node) ; node test/integration.mjs voor workerd-test
npx wrangler login
npx wrangler deploy
```
Instellingen staan in `worker/wrangler.toml`:
- `ALLOWED_ORIGINS`: komma-gescheiden lijst origins die de API mogen gebruiken.
- `TRANSLATE_MODEL`: elk Workers AI-chatmodel, bijv. `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
  voor hogere kwaliteit (±3× duurder).

Automatisch deployen via GitHub Actions werkt zodra de repo-secrets `CLOUDFLARE_API_TOKEN`
(template "Edit Cloudflare Workers" + Workers AI) en `CLOUDFLARE_ACCOUNT_ID` zijn ingesteld.

## API

| Route | Beschrijving |
|---|---|
| `GET /feed?url=` | RSS/Atom → JSON (titel, link, samenvatting, plaatje, datum, categorieën). Cache 10 min. |
| `GET /article?url=&translate=1` | Leesbare alinea's uit de pagina + NL-vertaling; `paywall: true` bij betaalmuur. Cache 24 u. |
| `POST /translate {texts[], source}` | Korte teksten vertalen, per tekst gecachet. |
| `GET /health` | Status en gebruikt model. |
