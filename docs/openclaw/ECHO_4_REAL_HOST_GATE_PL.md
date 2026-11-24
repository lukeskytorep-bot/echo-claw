# ECHO-4 — formalna bramka realnego hosta

Finalny PASS ECHO-4 wymaga wykonania poniższych punktów na prawdziwym OpenClaw 2026.11.7 z Node mieszczącym się w zweryfikowanym zakresie ECHO-4 rc.4 (24.16+ na 24.x albo 26.1+ na 26.x).

## Gate H1 — preflight

`node installer/echo4-install.mjs preflight --require-gateway --json`

PASS: Node i OpenClaw zgodne, config validate PASS, plugin validate PASS, Gateway RPC dostępny. Przed instalacją operator jawnie przegląda `openclaw.plugin.json` i zatwierdza capabilities osobną flagą `--accept-capabilities`.

## Gate H2 — runtime registration

`node installer/echo4-host-self-test.mjs`

PASS: aktywny runtime rejestruje oba narzędzia ECHO i wszystkie trzy hooki transportowe; wymagane permissions są aktywne.

## Gate H3 — fizyczny provider smoke

`node installer/echo4-live-gateway-smoke.mjs --confirm-provider-call`

PASS: dokładnie jedna nowa sesja testowa, co najmniej jeden zaakceptowany step result, co najmniej jeden `COMPLETED` transport receipt i brak Reveal.

## Gate H4 — restart Gateway

Wykonaj `openclaw gateway restart`, następnie ponownie H2 i H3.

PASS: plugin wraca po restarcie, bazy są czytelne, runtime registration nie znika, kolejny provider smoke przechodzi.

## Gate H5 — pełna sesja

`node installer/echo4-live-gateway-smoke.mjs --confirm-provider-call --full-session`

PASS: sesja RV Lite Core przechodzi legalną sekwencję aż do Reveal, Post-Reveal i `CLOSED`; baza zawiera fizyczne receipts i dokładnie jeden Reveal.

## Gate H6 — backup/rollback instalatora

Na osobnej testowej instalacji wykonaj instalację, zapisz katalog transakcji, potem jawny rollback. PASS: plugin znika, konfiguracja i zarządzane pliki workspace wracają do stanu sprzed instalacji.

## Dowody do zachowania

- wynik `openclaw --version`;
- `openclaw gateway status --deep --require-rpc`;
- `openclaw plugins inspect echo-claw --runtime --json`;
- JSON z `echo4-host-self-test.mjs`;
- JSON-y z one-step oraz full-session live smoke;
- identyfikatory transakcji instalatora i backupu konfiguracji;
- commit SHA repo użytego do instalacji.

Finalny PASS offline nie zastępuje H1–H6.
