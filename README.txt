Q2Stats Beta

Lägg dina JSON-filer i samma mapp:
- matches.json
- elo_team.json
- elo_1v1.json
- weapon_stats.json
- elo_history.json

Starta lokalt:
    cd /d F:\Quake2\q2pro\stats_overlay\q2stats-beta
    py -m http.server 8000

Öppna:
    http://localhost:8000/

Spelarprofil:
    http://localhost:8000/player.html?name=fasadin

OBS:
Sidan är byggd för att läsa dina nuvarande JSON-filer, men om fältnamnen i matches.json
avviker från de vanligaste varianterna behöver app.js finjusteras efter just din fil.
