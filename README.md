# TryHackX Media Server — paczki prywatne

Zawartość folderu `frontend/vendor` serwera [TryHackX Media Server](https://github.com/TryHackX/media-server):
paczki, których wolno używać na własnym serwerze, ale których licencje nie pozwalają publikować.
**Nie rozpowszechniać.** Repozytorium ma być prywatne.

| Folder | Co to jest | Pliki |
|---|---|---|
| `avs-presets` | presety Winamp AVS (paczki VISBOT i inne) | 17 527 |
| `avs-apes` | porty wtyczek AVS bez opublikowanych źródeł | 52 |
| `avs-videos` | klipy efektu AVI z paczek AVS (atlasy klatek) | 67 |
| `milkdrop-presets` | dodatkowe paczki presetów MilkDrop | 16 447 |
| `milkdrop-textures` | tekstury presetów MilkDrop | 599 |
| `shader-visualizers` | shadery Monkey Hi Hat i music_visualizer | 486 |
| `cthugha` | port Cthugha-L do „Klasyki retro” | 44 |
| `voltviz-extra` | Moss Ball i Flame do VoltViz (CC BY-NC) | 4 |
| `voltviz-logos` | logotypy do „Your Logo” w VoltViz | 4 |
| `fontawesome-pro` | Font Awesome Pro 7 (paczka *web*), na licencji właściciela | 84 |

Pochodzenie i licencje: pliki `SOURCE.*`, `LICENSE*` i `THIRD_PARTY_NOTICES.md` w folderach paczek oraz
`docs/FRONTEND.md` w repozytorium serwera.

## Użycie

```bash
git clone https://github.com/TryHackX/media-server.git
git clone https://github.com/TryHackX/media-server-vendor.git media-server/frontend/vendor
```

Potem instalator z folderu `media-server`: Windows — `Install.cmd` albo `Zainstaluj.cmd`, Debian 13 —
`sudo bash zainstaluj-debian.sh`. Sam zbuduje interfejs z tymi paczkami i zainstaluje gotowy wynik.

- **Windows:** wcześniej raz `git config --global core.longpaths true` — nazwy części presetów mają do
  210 znaków. Przy pierwszym klonowaniu prywatnego repozytorium git otworzy logowanie do GitHuba.
- **Debian:** zamiast hasła token (*fine-grained*, tylko to repozytorium, *Contents: Read-only*).
- **Aktualizacja:** `git pull` w obu klonach, potem instalator → aktualizacja; interfejs buduje się od nowa.

Tag `v1.0.0` — paczki do wydania 1.0.0 serwera.
