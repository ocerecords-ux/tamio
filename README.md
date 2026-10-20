# Tamio

Prototyp navigační aplikace: skutečná mapa, hledání adres, výběr ze tří tras, hlasová navigace česky a hlášení událostí na silnici.

## Spuštění

V Terminálu:

```
cd ~/Documents/GitHub/tamio
python3 -m http.server 8000
```

Pak otevři v prohlížeči **http://localhost:8000**. Poloha funguje jen přes `localhost` nebo `https`, ne při otevření souboru dvojklikem.

Na mobilu: telefon a Mac ve stejné Wi-Fi, na telefonu otevři `http://<IP adresa Macu>:8000`. Poloha z telefonu ale vyžaduje `https`, takže pro test na mobilu je nejjednodušší nahrát složku na hosting s HTTPS (např. GitHub Pages nebo Netlify).

## Co umí

- Mapa OpenStreetMap v tmavém režimu, sledování tvé polohy
- 3D pohled: budovy z OpenStreetMap (dlaždice OpenFreeMap) a prostorový terén, přepínač 2D/3D nahoře i během jízdy
- Hledání adres a míst (Nominatim), cíl i podržením prstu na mapě
- Rychlá tlačítka Benzinka, Nabíječka, Parkování (hledá v okolí)
- Až tři trasy s označením Nejrychlejší / Klidná (nejméně odbočení) / Nejkratší
- Navigace s pokyny česky, hlasem, časem příjezdu a přepočtem při sjetí z trasy
- Jízda nanečisto – simulace jízdy po trase pro testování u stolu
- Hlášení (kolona, nehoda, policie, uzavírka, překážka, počasí), potvrzení „Stále tam“ / „Už tam není“ a upozornění na hlášení před tebou na trase
- Uložená místa Domů a Práce s aktuálním časem cesty

## Omezení prototypu

- Hlášení a uložená místa se ukládají jen v daném prohlížeči. Sdílení mezi řidiči potřebuje vlastní server.
- Trasy počítá veřejný demo server OSRM a adresy hledá veřejný Nominatim. Oba mají limity a nejsou pro ostrý provoz; pro skutečné nasazení je potřeba vlastní server nebo placená služba.
- Trasy zatím nezohledňují aktuální dopravu.
- Terén zatím pochází z volně dostupných celosvětových výškových dlaždic (AWS Terrain Tiles). Přesnější data ČÚZK (DMR 5G) je potřeba nejdřív převést na dlaždice.
- U budov bez zadané výšky v OpenStreetMap se použije odhad.

## Soubory

- `index.html` – struktura obrazovek
- `style.css` – vzhled
- `app.js` – logika (mapa, hledání, trasy, navigace, hlášení)
