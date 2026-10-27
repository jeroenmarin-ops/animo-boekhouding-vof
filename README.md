# ANIMO Boekhouding VOF

Een responsive GitHub Pages-prototype voor een Belgische VOF met verkoop, aankopen, bank en kas, btw, vennoten, rapporten en registratie van externe Peppol-verwerking.

## Belangrijk

Dit is een functioneel frontendprototype. Demogegevens worden in `localStorage` bewaard. Gebruik dit prototype niet als definitieve wettelijke boekhouding zonder backend, auditcontroles, back-ups en validatie door een Belgische accountant.

De app verzendt of ontvangt zelf niets via Peppol. Ze registreert alleen de externe workflow.

## Snel publiceren op GitHub Pages

1. Maak een nieuwe repository.
2. Upload alle bestanden uit deze map naar de hoofdmap van de repository.
3. Open **Settings > Pages**.
4. Kies **Deploy from a branch**.
5. Selecteer `main` en `/ (root)`.
6. Sla op.

GitHub Pages gebruikt `index.html` als ingang. Er is geen buildstap nodig.

## Lokaal testen

Open `index.html` rechtstreeks of start een lokale server:

```bash
python3 -m http.server 8080
```

Open daarna `http://localhost:8080`.

## Bestanden

- `index.html`: applicatieschil
- `styles.css`: responsive ontwerp
- `app.js`: navigatie, demogegevens, formulieren en export
- `supabase-schema.sql`: startdatabase met RLS
- `.nojekyll`: voorkomt Jekyll-verwerking

## Productieklaar maken

1. Maak een Supabase-project.
2. Voer `supabase-schema.sql` uit in de SQL Editor.
3. Voeg Supabase Auth toe.
4. Vervang `localStorage` in `app.js` door beveiligde database-aanroepen.
5. Gebruik alleen de public/publishable key in de frontend. Plaats nooit de service-role key in GitHub.
6. Voeg Storage-buckets toe voor bewijsstukken.
7. Test RLS met minstens twee gescheiden ondernemingen.
8. Laat rekeningschema, btw-codes, rapporten en afsluitlogica controleren door een Belgische accountant.

## Huidige functies

- Mobiel en desktop dashboard
- Verkoopfactuur toevoegen en filteren
- Aankoopfactuur toevoegen
- Bank- en kasoverzicht
- Dagboekenoverzicht
- Btw-positie
- Vennoten en voorlopige winstverdeling
- Externe Peppol-status
- JSON-export
- Demodata resetten
