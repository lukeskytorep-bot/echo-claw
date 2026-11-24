# ECHO-CLAW ECHO-4 FIX A1–A7 — raport do ponownego audytu

Wersja: **0.4.0-rc.4**  
Punkt wyjścia: niezależny audyt GPT-6.2 wersji 0.4.0-rc.3.

## Zakres

Ta runda nie zmienia Protocol Pack, Session Core, Reveal Gate, transport semantics ECHO-3 ani biblioteki 126 targetów. Dotyczy wyłącznie bezpieczeństwa instalatora, rollbacku, runtime inspection i weryfikacji dowodów live-smoke.

## A1 — odczyt stanu fail-closed

- `plugins list --json` z błędem kończy plan/instalację jako `PLUGIN_LIST_FAILED`;
- `config get` rozróżnia potwierdzone `path/key/config not found` od błędu CLI, timeoutu, backendu lub błędnego JSON;
- brak wiarygodnego snapshotu blokuje pierwszą mutację.

Testy: `E4-FIX-R01`, `R02`, `R10`, baseline `E4-T36/T37` w podzielonym zestawie instalatora.

## A2 — rollback musi być weryfikowalny

- każdy `config set/unset` podczas restore ma sprawdzany kod zakończenia;
- po restore stan jest ponownie odczytywany i porównywany ze snapshotem;
- błąd daje `ROLLBACK_INCOMPLETE`, nie fałszywe `ROLLED_BACK`.

Testy: `E4-FIX-R03` oraz baseline `E4-T38`.

## A3 — ochrona późniejszych zmian użytkownika

Transakcja przechowuje stan przed instalacją i stan bezpośrednio po instalacji. Przed rollbackiem ECHO porównuje bieżący config i pliki workspace ze stanem, który samo zapisało. Obca zmiana blokuje rollback jako `ROLLBACK_BLOCKED_USER_CHANGES`. Destrukcyjne cofnięcie wymaga jawnego `--force-user-changes`. Dotyczy to również automatycznego rollbacku po późniejszej awarii instalacji.

Testy: `E4-FIX-R04`, `R12`, `R13` oraz baseline `E4-T39/T47/T48`.

## A4 — izolacja backupów workspace

Backup path zawiera rolę (`monitor`/`viewer`) i skrót pełnej ścieżki. Dodatkowo Monitor i Viewer nie mogą wskazywać tego samego ani zagnieżdżonego workspace.

Testy: `E4-FIX-R05`, `R09`, baseline `E4-T40/T44`.

## A5 — strukturalny runtime inspection

Walidator nie szuka już nazw narzędzi/hooków rekurencyjnie w dowolnym JSON. Dla targetu OpenClaw 2026.11 wymaga:

- `plugin.id == echo-claw`;
- `inspectionScope == cli`;
- top-level `imported == true`;
- status rejestru pluginu nie jest `disabled/error/blocked` (OpenClaw zachowuje cold-registry status oddzielnie od wyniku importu runtime);
- `plugin.toolNames` zawiera oba narzędzia ECHO;
- top-level `typedHooks` zawiera `before_model_request`, `model_call_started`, `model_call_ended`;
- brak fatalnych diagnostyk.

To odpowiada aktualnemu kontraktowi `openclaw plugins inspect <id> --runtime --json`: raport zachowuje status rejestru pluginu, osobno oznacza `inspectionScope: cli` i `imported`, a rejestracje runtime raportuje przez `plugin.toolNames` oraz top-level `typedHooks`. Sama wzmianka w `diagnostics` nie jest dowodem rejestracji.

Testy: `E4-FIX-R06`, `R14`, baseline `E4-T41/T49`.

## A6 — dowód live-smoke jest relacyjny, nie licznikowy

`verifySessionEvidence()` wymaga jednego konkretnego nowego `session_id` i kontroluje:

- `rv-lite-core` / `1.1.0`;
- `human_user`;
- `no_code`;
- `manual`;
- sesję utworzoną po rozpoczęciu smoke;
- każdy zaakceptowany attempt ma dokładnie jeden step result;
- step result wskazuje ten sam transport co `response_transport_attempt_id`;
- receipt należy do tego samego attemptu i ma `COMPLETED`;
- chronologia `authorized_at <= completed_at <= accepted_at`;
- brak obcych zaakceptowanych bindingów;
- dokładna sekwencja wymaganych kroków;
- w full-session dokładnie jeden Reveal, po wszystkich blind results, oraz stan `CLOSED`.

Testy: `E4-FIX-R07`, `R11`, baseline `E4-T42/T46`.

## A7 — crash-safe install intent

Przed `openclaw plugins install` transakcja jest trwale zapisana jako `PLUGIN_INSTALL_PENDING` / `installIntent.status=PENDING`. `writeJson()` używa pliku tymczasowego, fsync, atomic rename i próby fsync katalogu. Jeżeli proces zginie po zewnętrznej instalacji, rollback rekoncyliuje `PENDING` z rzeczywistym `plugins list`; plugin należący do tej transakcji jest następnie usuwany.

Test: `E4-FIX-R08`, baseline `E4-T43`.

## Organizacja testów

Długi plik testów instalatora został podzielony na kilka procesów Node (`E4-T01–T20`, `T21–T30`, `T31–T40`, `T41–T44`, `T45–T49`). To nie zmienia testowanej logiki. Rozdzielenie ogranicza interferencję wielu procesów fake-CLI i daje deterministyczny wynik także w ograniczonych środowiskach CI.

Oryginalne skrypty reprodukcyjne audytu GPT-6.2 są zachowane bez zmian w `docs/development/audit-regressions/ECHO4_RC3_GPT62_AUDIT_REGRESSIONS_ORIGINAL.zip`. Ich przypadki zostały przepisane na wykonywalne testy regresyjne FIX.

## Status real host

**NOT_RUN w środowisku budowy.** Offline PASS nie jest uznawany za certyfikację OpenClaw Gateway. H1–H6 z `docs/openclaw/ECHO_4_REAL_HOST_GATE_PL.md` pozostają obowiązkowe przed finalnym ECHO-4 PASS i przed publikacją tej wersji na `main`.

## Wynik końcowy offline

Po poprawkach A1-A7:

- ECHO-2: **76/76 PASS**;
- ECHO-3: **57/57 PASS**, w tym 16 pełnych scenariuszy sesji;
- ECHO-4 baseline/host: **49/49 PASS**;
- regresje GPT-6.2 A1-A7: **14/14 PASS**;
- razem: **196/196 PASS**;
- Protocol Pack baseline: 4/4 + execution overlay + 126/126 targetów;
- oryginalny `audit-extra.mjs` zatrzymuje się teraz fail-closed na `PLUGIN_LIST_FAILED`;
- oryginalny syntetyczny przypadek A6 zwraca `ok:false`;
- oryginalny crash A7 kończy rollbackiem z `pluginStillInstalled:false`.

Real-host H1-H6 pozostaje `NOT_RUN` i nie jest objęty tym offline PASS.
