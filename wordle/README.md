# Lea Igre 🎮

Discord bot za Uazalenje Community. Prva igra je **Wordle na srpskom jeziku**.

## Komande

- `/wordle` — pokreni današnji izazov
- `/pogodi <reč>` — pošalji pokušaj
- `/wordle-stats` — tvoja statistika
- `/wordle-top` — rang-lista
- `/profil` — tvoj Lea Igre profil

## Pravila

- Jedna reč dnevno za ceo server
- Reči su na srpskom
- 6 pokušaja
- 🟩 slovo je na pravom mestu
- 🟨 slovo postoji, ali je na drugom mestu
- ⬛ slovo ne postoji
- Bez dijakritika takođe možeš da pogađaš: `sreca` = `sreća`

## Railway

Environment Variables:
`DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `WORDLE_CHANNEL_ID`

Ako je ovaj projekat u GitHub podfolderu `wordle`, u Railway-u stavi **Root Directory** na `/wordle`.

Za trajnu SQLite bazu napravi Railway Volume sa mount path-om:
`/app/data`

## Samo jedan kanal

Wordle komande rade samo u jednom Discord kanalu. U Railway Variables dodaj:

`WORDLE_CHANNEL_ID` = ID kanala u kom želiš da bude Wordle.

Na primer, ako napraviš kanal `#wordle`, kopiraj njegov Channel ID i stavi ga kao vrednost promenljive.

Komande `/wordle`, `/pogodi`, `/wordle-stats` i `/wordle-top` biće dostupne samo u tom kanalu.


### Dodatne Wordle partije

`/wordle` je dnevni izazov. Kada igrač završi Daily, može da nastavi koliko želi preko `/wordle-igra`. Svaka dodatna partija ima novu nasumičnu reč, 6 pokušaja, a `/pogodi` automatski pogađa aktivnu dodatnu partiju.
