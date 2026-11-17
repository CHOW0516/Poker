# Friends Poker

Online No Limit Texas Hold'em to play with friends in the browser. Play chips only, no real money, no sign-up.

## How to play

1. Open the site, type your name and click **Create table**.
2. Click **Copy invite link** and send it to your friends (2 to 9 players).
3. When everyone is seated, the host clicks **Start game**. New hands then start automatically.

A player with no chips can click **Rebuy** between hands. A player who loses their connection keeps their seat for 5 minutes and can come back with the same link.

## Run on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```
npm install
npm start
```

Then open http://localhost:3000. Run the tests with `npm test`.

## Put it online (Render, free plan)

1. Sign in at https://render.com with your GitHub account.
2. Click **New**, then **Blueprint**, and pick this repository. Render reads `render.yaml` and sets everything up.
3. When the deploy finishes, Render shows your public link. Share that link with friends.

On the free plan the server sleeps when nobody uses it, so the first visit can take about 30 seconds. Tables are kept in memory, so a server restart ends running games.

## Project layout

- `server/cards.js` – the deck and shuffle
- `server/handRanking.js` – finds and compares the best five-card hand
- `server/game.js` – all game rules: blinds, betting, side pots, showdown
- `server/server.js` – web server, tables (rooms), timers and real-time messages
- `public/` – the page, styles and browser code
- `test/` – automated tests
