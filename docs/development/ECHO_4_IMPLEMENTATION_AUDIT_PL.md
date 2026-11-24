# ECHO-CLAW ECHO-4 0.4.0-rc.3 — raport implementacyjny do audytu

## Cel etapu

ECHO-4 nie zmienia zatwierdzonych protokołów ani Session Core. Dodaje warstwę bezpiecznej instalacji i formalne bramki odbioru na prawdziwym OpenClaw Gateway.

## Zmiany względem ECHO-3 0.3.4

1. Ustalenie konserwatywnego, zweryfikowanego przez ECHO zakresu hosta Node: `>=24.16.0 <25 || >=26.1.0 <27`. OpenClaw dopuszcza obecnie także Node 27 jako linię development, lecz RC3 celowo jej nie akceptuje bez osobnego audytu kompatybilności ECHO.
2. `installer/echo4-install.mjs`:
   - preflight wersji i konfiguracji;
   - `openclaw plugins validate --root <repo> --entry ./dist/index.js --json`;
   - read-only plan i conflict detection;
   - zweryfikowany backup konfiguracji przed mutacją;
   - local-link lub Git install z osobnym potwierdzeniem źródła (`--force`) i capabilities (`--accept-capabilities`);
   - ustawienie hook permissions;
   - przygotowanie workspace Monitora/Viewera;
   - zachowanie istniejącego allowlistu `main`;
   - wymagany Gateway plugin reload, gdy RPC jest osiągalny, oraz runtime inspect;
   - rollback automatyczny przy błędzie;
   - jawny rollback z katalogu transakcji po udanej instalacji.
3. `installer/echo4-host-self-test.mjs` sprawdza działający Gateway RPC, runtime registration i konfigurację zabezpieczeń.
4. `installer/echo4-live-gateway-smoke.mjs` wykonuje opt-in rzeczywisty test providera. Dowód jest odczytywany z Session Core SQLite, a nie z deklaracji modelu.
5. Tryb `--full-session` wymaga RV Lite Core aż do Reveal, Post-Reveal i CLOSED.
6. Dodano wrapper Windows PowerShell i POSIX.

## Offline testy ECHO-4

Nowa grupa E4-T01–E4-T35 obejmuje m.in.:

- odrzucenie Node 22, Node 24 < 24.16, Node 26 < 26.1 oraz linii spoza wąskiego, zweryfikowanego zakresu ECHO-4 (w tym Node 27 development);
- pin stabilnej linii OpenClaw 2026.11 i fail-closed dla prerelease;
- plugin/config preflight;
- Gateway required/optional;
- conflict detection;
- clean local-link install;
- merge owner tool do istniejącego allowlistu;
- izolację Monitor/Viewer tool policy;
- backup przed plugin install;
- runtime registration requirements;
- odmowę automatycznej wymiany istniejącego pluginu;
- backup workspace przy force-conflict;
- wymuszoną awarię po mutacjach i rollback;
- Git install wyłącznie z jawnym, przypiętym ref;
- obowiązkową, osobną zgodę operatora na capabilities przed jakąkolwiek mutacją;
- poprawną walidację built entry przez `--root` + `--entry`;
- wymagany reload aktywnego Gateway i rollback po jego awarii;
- dokładne przywrócenie wcześniejszej konfiguracji pluginu po rollbacku;
- host self-test wymaga także owner tool policy dla `main`;
- brak niejawnego Gateway restart;
- jawny rollback zakończonej instalacji.

## Ograniczenie środowiska budowy

Kontener, w którym zbudowano ten kandydat, ma Node 22.16.0 i nie ma OpenClaw CLI. Jest to obecnie środowisko **nieobsługiwane przez OpenClaw**. Dlatego nie przedstawiamy offline testów jako real-host PASS.

Do finalnego ECHO-4 PASS wymagane są bramki H1–H6 opisane w `docs/openclaw/ECHO_4_REAL_HOST_GATE_PL.md` na prawdziwym OpenClaw 2026.11.7 i wspieranym Node.

## Co nie zostało zmienione

- Protocol Pack i cztery zatwierdzone protokoły;
- 126 targetów;
- Session Core / Vault / Reveal Gate;
- ECHO-3 transport receipt i Recovery semantics;
- licencje MIT / CC BY 4.0.

## Wynik offline 0.4.0-rc.3

- pełny zestaw Node: **168/168 PASS**;
- testy ECHO-4: **35/35 PASS**;
- pełna macierz symulowanych sesji ECHO-3: **16/16 PASS**;
- baseline: **4/4 protokoły + overlay + 126 targetów PASS**;
- syntax-check: **27/27 PASS**.

Te wyniki są dowodem offline. Finalny PASS ECHO-4 pozostaje zależny od bramek H1–H6 na rzeczywistym OpenClaw Gateway.
