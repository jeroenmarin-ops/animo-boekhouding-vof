# ANIMO Boekhouding VOF · Supabase-versie

Dit is de echte databaseversie voor GitHub Pages.

## Upload naar GitHub
Vervang in je repository de bestaande bestanden door:
- index.html
- styles.css
- app.js
- config.js
- .nojekyll

Upload ook `supabase-extra-beveiliging.sql` niet naar de publieke site als functioneel bestand. Open het bestand en voer de inhoud eenmalig uit in Supabase SQL Editor.

## Eerste gebruik
1. Open de GitHub Pages-site.
2. Maak een account aan.
3. Meld aan.
4. Vul de VOF-gegevens en het boekjaar in.
5. De app maakt via Supabase automatisch periodes, grootboekrekeningen, btw-codes en dagboeken.

## Beveiliging
De frontend bevat uitsluitend de Supabase publishable key. Gebruik nooit een secret/service-role key in GitHub.
