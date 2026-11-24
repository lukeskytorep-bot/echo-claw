# ECHO-3 OpenClaw Integration - macierz testów

Aktualny kandydat ECHO-3 FIX zachowuje komplet 76 testów ECHO-2 i 28 pierwotnych testów integracyjnych E3-T01-E3-T28. Zachowuje testy A1–A8, dodaje regresje awarii B1–B2, migrację v2→v3 oraz pełną macierz sesji end-to-end.

## Główne grupy

- manifest/plugin surface i brak model-authored authority;
- owner binding i rozdzielenie owner-facing agent / AI Monitor;
- egzekwowanie właściwego prowadzącego przed privilege elevation;
- redakcja celu przed Reveal;
- trwałe dowody fizycznych wywołań providera;
- ścisłe `runId + callId`, bez fallbacku do innego transportu;
- retry po błędzie/UNKNOWN i blokada drugiego dispatch po `COMPLETED`;
- fail-closed przy braku finalnego hooka transportowego;
- Viewer `disableTools:true`, persistent `sessionKey` i generation continuity;
- Recovery: jawny rebind nowej generacji i replay wyłącznie zaakceptowanych danych blind;
- crash-safe Recovery: runtime event `PENDING/APPLIED`, idempotentny Resume pomiędzy Session Core i Integration Store;
- owner/Monitor isolation;
- human/AI conductor separation;
- `no_code` bez pozostałości kodu;
- Telepathy T9 oraz neutral adjunct probes przez trusted verifier;
- T10 bez dopisywania nowych danych;
- pełne kanoniczne instrukcje protokołu w promptach Viewera, markery tylko jako output contract;
- inicjalizacja `dataDir` przed SQLite i rozwijanie `~`;
- integration store schema v3, migracje v1→v3 i v2→v3 z zachowaniem bindingów oraz legacy eventów jako `PENDING`;
- `assertInvocationCurrent` na ścieżkach efektów;
- trwałość binding/run/attempt w SQLite po reopen;
- pin OpenClaw 2026.11.7.

## Macierz pełnych sesji

16 scenariuszy przechodzi od startu przez wszystkie fazy i checkpointy do Reveal → POST_REVEAL → CLOSED:

- RCP 1.5a
- RV Lite Core 1.1.0
- RV Lite Extended 1.1.0
- Telepathy 1.1

Każdy protokół jest wykonywany jako:

- `human_user` + `neutral_code`
- `human_user` + `no_code`
- `ai_monitor` + `neutral_code`
- `ai_monitor` + `no_code`

## Warunek odbioru lokalnego

- ECHO-2: 76/76 PASS
- pierwotne ECHO-3: 28/28 PASS
- naprawy/hardening A1-A8: 8/8 PASS
- Recovery B1-B2 + migracja v2→v3: 3/3 PASS
- pełna macierz: 16/16 scenariuszy PASS
- Node test runner łącznie: **132/132 PASS** (macierz ma również nadrzędny test grupujący)

## Czego te testy nie dowodzą

Mock host odtwarza używane kontrakty OpenClaw, ale nie zastępuje uruchomienia prawdziwego Gateway. Real plugin load/validate, real `before_model_request` i real model/provider smoke są odrębnym gate ECHO-4.
