# Deploy — audit.pionio.it (Railway)

Il tool è pronto per il deploy. Quello che segue **richiede i tuoi account** e va fatto
con calma: niente va online finché non sei tu a premere i pulsanti.

## Cosa fa già il codice
- `Dockerfile` su immagine Playwright ufficiale (Chromium + dipendenze incluse).
- `server.mjs` ascolta su `process.env.PORT` (Railway lo inietta da solo).
- Protezioni attive: anti-SSRF (blocca localhost/IP privati), rate limit (6/min per IP),
  max 2 analisi in parallelo, timeout 70s.
- Progetto autosufficiente: font e logo dentro `public/`, nessun path esterno.

## Passi per andare live (~15 min)

1. **GitHub** — crea un repo (es. `pionio-audit`) e fai il push di questa cartella.
   _(Posso prepararti i comandi git quando vuoi.)_

2. **Railway** — https://railway.com → New Project → *Deploy from GitHub repo* →
   scegli `pionio-audit`. Railway vede il `Dockerfile` e builda da solo.
   Piano **Hobby** (~5$/mese, paghi a consumo).

3. **Dominio** — su Railway, nel servizio → *Settings → Networking → Custom Domain* →
   inserisci `audit.pionio.it`. Railway ti dà un valore CNAME.

4. **DNS** — dove gestisci il DNS di pionio.it, aggiungi un record:
   `CNAME  audit  →  <valore-che-ti-dà-railway>`
   Propagazione: da pochi minuti a un'ora. HTTPS lo fa Railway in automatico.

5. **Verifica** — apri `https://audit.pionio.it`, prova un sito, controlla i log su Railway.

## Test in locale prima del deploy
```
node server.mjs            # → http://localhost:4040
```
Per simulare il container (se hai Docker):
```
docker build -t pionio-audit .
docker run -p 4040:4040 pionio-audit
```
