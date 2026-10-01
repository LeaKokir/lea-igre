# Lea Igre 🎮

Discord game bot for Uazalenje. First game: daily Wordle.

## Local setup

1. Install Node.js 20+
2. Copy `.env.example` to `.env`
3. Fill in:
   - DISCORD_TOKEN
   - CLIENT_ID
   - GUILD_ID
4. Run:
   npm install
   npm start

## Railway

Connect the GitHub repository to Railway and add the same three variables in Railway Variables.

For persistent SQLite data, create a Railway Volume and mount it at:
`/app/data`

The bot will automatically create `data/lea-igre.db`.

## Commands

/wordle
/pogodi <rec>
/wordle-stats
/wordle-top
/profil
