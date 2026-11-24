# ECHO-4 — instalacja na OpenClaw 2026.11.7

Status: kandydat 0.4.0-rc.4 po FIX A1–A7. Nie jest to jeszcze finalny release PASS; wymagane są bramki H1–H6 na rzeczywistym hoście.

## Wymagania

- OpenClaw 2026.11.7.
- ECHO-4 rc.4 dopuszcza Node `>=24.16.0 <25 || >=26.1.0 <27`. OpenClaw może akceptować także inne linie (obecnie Node 27 development), ale ECHO pozostaje fail-closed, dopóki dana linia nie przejdzie osobnego audytu pluginu/Gateway.
- skonfigurowany model dla agenta `main` i możliwość uruchamiania subagenta Viewera.
- repozytorium ECHO-CLAW z zaakceptowanym ECHO-3.

## 1. Kontrola przed instalacją

Windows PowerShell:

```powershell
node .\installer\echo4-install.mjs preflight --json
node .\installer\echo4-install.mjs plan --json
```

Linux/macOS/WSL:

```bash
node ./installer/echo4-install.mjs preflight --json
node ./installer/echo4-install.mjs plan --json
```

`plan` nie modyfikuje konfiguracji. Konflikt istniejącego `echo-monitor`, `echo-viewer` albo ECHO `dataDir` zatrzymuje zwykłą instalację.

## 2. Instalacja z bieżącego repo

### Jawna zgoda na capabilities

`--force` w OpenClaw potwierdza pochodzenie lokalnego/Git źródła, ale nie zatwierdza deklarowanych capabilities. ECHO-4 wymaga osobnej, jawnej flagi `--accept-capabilities` po przeczytaniu `openclaw.plugin.json`. Bez niej instalator kończy się przed pierwszą mutacją.


```bash
node ./installer/echo4-install.mjs install --source local-link --accept-capabilities --json
```

Instalator:

1. sprawdza wersję Node/OpenClaw, konfigurację i manifest pluginu;
2. zapisuje weryfikowaną kopię konfiguracji OpenClaw;
3. instaluje ECHO jako lokalny link;
4. ustawia wymagane hook permissions;
5. tworzy/uzupełnia workspace Monitora i Viewera;
6. ogranicza Monitor do `echo_monitor_session`, a Viewerowi blokuje narzędzia;
7. dodaje `echo_owner_session` do polityki `main` bez usuwania istniejącego allowlistu;
8. waliduje konfigurację;
9. jeśli Gateway RPC jest już osiągalny, wymaga udanego `plugins reload echo-claw --wait --json`;
10. sprawdza runtime registration.

Instalator nie uruchamia sam `gateway restart`. Dla aktywnego Gateway używa bezpieczniejszego `plugins reload echo-claw --wait --json`; pełny restart jest osobnym testem H4.

## 3. Instalacja z GitHuba

Po sprawdzeniu konkretnego commita można użyć:

```bash
node ./installer/echo4-install.mjs install --source git --git-ref <COMMIT_SHA> --accept-capabilities --json
```

Źródło jest instalowane jako `git:github.com/lukeskytorep-bot/echo-claw@<COMMIT_SHA>`. Dla powtarzalności zalecany jest commit SHA zamiast ruchomego brancha.

## 4. Aktywny Gateway

Po instalacji uruchom lub przeładuj Gateway zgodnie z własnym sposobem instalacji, a następnie:

```bash
node ./installer/echo4-host-self-test.mjs
```

Self-test wymaga:

- działającego RPC Gateway;
- poprawnego runtime inspect pluginu;
- `echo_owner_session` i `echo_monitor_session`;
- hooków `before_model_request`, `model_call_started`, `model_call_ended`;
- wymaganych hook permissions;
- właściwych polityk narzędzi Monitora/Viewera.

## 5. Rollback

Każda instalacja zapisuje katalog transakcji, domyślnie pod:

`~/.openclaw/echo-claw-install-transactions/`

Automatyczny rollback działa przy błędzie w trakcie instalacji. Po udanej instalacji można wykonać jawny rollback:

```bash
node ./installer/echo4-install.mjs rollback --transaction <KATALOG_TRANSAKCJI> --json
```

Rollback przywraca wartości konfiguracji zapisane przed instalacją, przywraca/usuwa pliki workspace zarządzane przez tę transakcję i odinstalowuje plugin, jeżeli właśnie ta transakcja go zainstalowała.

## 6. Test providera i pełnej sesji

Te testy powodują rzeczywiste wywołania modelu i są opt-in.

Jeden krok Viewera:

```bash
node ./installer/echo4-live-gateway-smoke.mjs --confirm-provider-call
```

Pełny RV Lite Core aż do Reveal/Post-Reveal/CLOSED:

```bash
node ./installer/echo4-live-gateway-smoke.mjs --confirm-provider-call --full-session
```

Skrypt nie uznaje samej odpowiedzi agenta za dowód. Po turze odczytuje bazę Session Core i wymaga zaakceptowanego kroku powiązanego z zakończonym fizycznym transport receipt. Pełny test wymaga dodatkowo `CLOSED` i dokładnie jednego Reveal.
