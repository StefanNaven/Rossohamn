# Rossöhamn v2

Statisk webbplats för energi, hushåll, tekniska verktyg och publik datakvalitet. Ingen server, databas eller ny hemlighet krävs. Befintlig publicering från Homey fortsätter att äga datafilerna.

## Installera som en uppdatering, inte som en ny webbplats

Det här paketet är ett **overlay** för `StefanNaven/Rossohamn` (branch `main`). Det är inte en komplett klon. Packa upp filerna ovanpå en aktuell klon av repot. Behåll alla filer som inte ingår i paketet. Kopiera även den dolda mappen `.github`. Ladda INTE upp ZIP-filen som en ensam fil till GitHub Pages.

1. Hämta aktuell `main` från GitHub. Skapa en separat branch, t.ex. `redesign/v2`.
2. Kopiera in alla filer i ZIP-paketet med bibehållen mappstruktur; ersätt filer med samma sökväg. Behåll `CNAME` och befintliga pris-/sophämtningsdata.
3. Kör `npm test` och `npm run check` (Node 22 och Python 3). Starta en lokal testserver från repots rot med `python3 -m http.server 8080`, och besök `http://localhost:8080/`.
4. Kontrollera startsida, energi, båda graferna, prisintervall vid klick, avgiftsinställningar, sophämtning, kalenderexport, verktyg och datastatus. Testa i mobil och desktop.
5. Commit och skapa en pull request till `main`. Låt GitHub Actions köra kontrollerna. Mergas först efter granskning. Undvik force push, att återställa hela `main` eller att skriva över nyare JSON-data.
6. Kontrollera GitHub Pages-publiceringen och att Homey fortfarande hämtar samma två dagsfiler. Kontrollera nästa schemalagda publicering från Homey.

Befintliga Pages-inställningar och `CNAME` ska inte ändras. Sidan förutsätter att den serveras från webbplatsens rot (som den befintliga webbplatsen), inte från en underkatalog i en separat GitHub Pages-projektsida.

## Skyddade filer – lämnas oförändrade

- `CNAME`
- `spotprices/history.json`
- `spotprices/api/today.json`
- `spotprices/api/tomorrow.json`
- `spotprices/spotprices.json` (äldre format)
- `garbagecollection/data/latest.json`
- `garbagecollection/data/garbagetable.json`
- `GarbageCollection/data/garbagetable.json` (äldre, skiftlägeskänslig sökväg)
- `spotprices/app.js`, `spotprices/lib/series.js`, `spotprices/lib/chart-utils.js`
- `tests/series.test.js`

Homey använder GitHub Contents API (GET för SHA, PUT med Base64 och SHA) och läser de statiska dagsfilerna från www.rossohamn.se. Det äldre upplägget har även använt versal `GarbageCollection`; den duplicerade mappen och det gamla elprisformatet tas därför INTE bort förrän alla externa skript har inventerats. Exakta aktuella Raspberry Pi-jobb är inte verifierade. Ingen ny prisdata eller sophämtningsdata ingår i uppdateringen.

Startsidan och statussidan använder `raw.points`, inte extrapolerade priser, samt `meta.date`, `meta.updatedAt`, `timeline` och upplösningen. Befintlig avancerad spotprisgraf och dess historiklogik bevaras; den nya `cost-examples.js` har samma `attachCostExamples`-gränssnitt. Externa Homey-skript och Logic-variabler ändras inte. Saknad eller för gammal prisdata visas inte som aktuell.

## Ny struktur

- `/`: dashboard med spotpris, uppskattat rörligt totalpris, graf, billigaste kommande sammanhängande 2/4/8 timmar, sophämtning och datastatus.
- `/spotprices/`: befintliga historikgrafer, intervall, enheter, datumval och interpoleringsval; gemensamma tariffinställningar; elbilskalkyl (ingen automatisk styrning).
- `/household/`: länkar till sophämtning, extern områdesprognos med soluppgång/solnedgång.
- `/garbagecollection/`: datum, nedräkning, datastatus och export av publicerade datum till `.ics`.
- `/tools/`, `/tools/network/`: JSON, UTF-8 Base64, tidsstämplar, IP, DNS, IPv4-subnät, webbläsarinformation.
- `/status/`: aktuell validering av publika datafiler och de senaste 20 kontrollerna lokalt i webbläsaren.
- `/config/site.json`: väderkoordinater och tröskelvärden för datakvalitet.
- `/config/energy.json`: gemensamma standardvärden för kostnadsberäkningen.
- `/assets/css/base.css`: gemensam design; `spotprices/styles.css` innehåller bara grafregler.
- `/assets/js/`: gemensamma funktioner och separata moduler.
- `.github/workflows/`: tester, datakontroll, dependency review på publika PR:er och manuell Lighthouse.

Gamla platshållare (Aktuellt, Publiceringar, Fritid, Praktisk info) och dubblerad IP-widget har tagits bort från presentationen. Gamla, nu oanvända `assets/home.css` och `garbagecollection/garbage.css` kan rensas efter verifiering av externa referenser; de tas inte bort av overlay-paketet.

## Elavgifter och Homey

`config/energy.json` innehåller senast kända exempelvärden från arbetet 2026-11-17: påslag 5,30 öre/kWh exkl. moms, nätöverföring 26 öre/kWh inkl. moms, energiskatt 45 öre/kWh inkl. moms och moms 25 %. **De är inte liveverifierade mot nuvarande avtal.** `updatedAt: null` markerar att publicering från Homey ännu inte har körts. Kontrollera och ändra vid behov innan produktion. Fasta avgifter och eventuell effekttariff ingår inte.

Formel: `(spotOre + supplierMarkupOreExVat) * (1 + vatPercent/100) + gridTransferOreIncVat + energyTaxOreIncVat` (öre/kWh). Användarens befintliga `rossohamn_*`-inställningar i localStorage har företräde. Återställ via Energi → Ditt elavtal för att använda publicerade grundvärden. Inställningarna gäller i samma webbläsare/origin, inte på alla enheter.

Ett separat HomeyScript, `PublishEnergyConfigToRossohamn.js`, levereras utanför ZIP-paketet. Det läser befintliga `Elhandel_RorligKostnad` i kr/kWh exklusive moms och omvandlar till öre/kWh. Det hämtar konfigurationsfilen, bevarar övriga värden, uppdaterar bara påslaget (och metadata) och läser tillbaka från GitHub. Skriptet använder en medveten säkerhetsgräns på ±100 öre/kWh, inte en påstådd laggräns. Det gör ingen uppdatering om påslaget är oförändrat och tidigare uppdateringstid redan finns. Konfigurationsfilen måste finnas före första körning.

1. Skapa skriptet i HomeyScript, INTE i det publika GitHub-repot. Använd din befintliga GitHub-token för repot (Contents read/write), lägg den endast i den privata Homey-miljön. Publicera aldrig token i en fil eller logg.
2. Kör med `DRY_RUN = true`. Kontrollera logg och att omräkningen stämmer (0,0530 kr → 5,30 öre).
3. Ändra sedan till `DRY_RUN = false` och kör manuellt. Verifiera att GitHub-filen ändras och att webbplatsen visar det nya standardvärdet efter publicering. Om en besökare sparat lokala värden behöver dessa återställas.
4. Lägg skriptet som ett efterföljande steg vid lyckad körning av `GetElpriskollenExtraCost.js`, exempelvis efter `UpdateDynamicElectricityPriceUserCost.js`. Ingen ändring av de två befintliga skripten behövs. Undvik parallell publicering till samma konfigurationsfil. Vid SHA-konflikt avslutas skriptet utan automatisk retry.

Dokumentation: [Homey ManagerLogic](https://athombv.github.io/node-homey-api/HomeyAPIV3Local.ManagerLogic.html), [GitHub Contents API](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28), [Open-Meteo](https://open-meteo.com/en/docs).

## Datastatus och integritet

- Dagens och morgondagens datum samt UTC-intervall valideras mot svensk tid, inklusive 23- och 25-timmarsdygn. Dagsfilerna ska innehålla metadata, timeline, raw, extrapolated och windows enligt befintliga format.
- Trösklar är valda som konfigurerbara driftvärden, inte SLA: pris 30 timmar, sophämtning 48 timmar, infotabell 720 timmar; morgondagens data förväntas från 16:00 svensk tid. En gammal avvikelsetabell är en varning, inte ett bevis på felaktigt datum. Schemalagd kontroll markerar inte gamla avvikelsetabeller som workflow-fel eftersom nya avvikelsedatum kan saknas under långa perioder.
- Kalenderexport är en engångs-ICS-fil med kommande publicerade datum, ingen liveprenumeration. Ingen framtida återkommande hämtning gissas.
- Väderprognosen använder ungefärliga områdeskoordinater (58,9 N, 11,2 E); inte en exakt bostadsadress. Ändra i `config/site.json` om önskat. Open-Meteo anropas först efter klick. IP- och DNS-tjänster anropas efter aktivt val, aldrig från startsidan.
- Inga inloggningsuppgifter, lokala IP-adresser eller intern Homey/Raspberry Pi-status läggs till i publika data. Det gamla adressvärdet i tidigare Git-historik försvinner inte genom en vanlig commit.
- Statushistoriken är endast lokal. Central övervakning skulle kräva en separat privat tjänst.

## Kvalitetssäkring

`npm test` kör befintliga tester plus `tests/dashboard-v2.test.js`. `npm run check` kontrollerar HTML-sidornas ID:n, labels och interna länkar samt validerar JSON-format i den sammanslagna webbplatsen; det är inte en full W3C-validator. `npm run check:freshness` kontrollerar aktualitet i repot och ska köras när dagens prisdata normalt är publicerade. Workflow körs en gång per dag 16:25 UTC (17:25 CET / 18:25 CEST). Actions är inte provkörda på GitHub. Den manuella Lighthouse-workflowen skapar rapportartefakter; Chart.js används fortfarande från befintlig CDN-version. Inga nya runtime-paket har lagts till.

Lokalt i testmiljön: 15 nya Node-tester passerade. HTML-/JSON-/freshness-kontroller passerade på en isolerad testuppsättning med simulerad data enligt granskat schema. Den faktiska befintliga `app.js` och Chart.js kunde inte köras där, eftersom GitHub-filer inte kunde överföras till den lokala runtime-miljön och webbläsarnavigering blockerades. Externa tjänster, faktisk Homey-publicering, befintliga serietester och GitHub Pages-deployment måste därför verifieras efter att paketet har lagts ovanpå repot. Testdata ingår inte i ZIP-paketet.
