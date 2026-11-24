# Handoff ECHO-2 -> ECHO-3 OpenClaw Integration

> Status 2026-11-24: zakres poniżej został zaimplementowany jako kandydat ECHO-3. Aktualny raport odbiorczy: `ECHO_3_IMPLEMENTATION_AUDIT_PL.md`. Real Gateway smoke pozostaje gate ECHO-4.

## Cel

ECHO-3 ma podłączyć zatwierdzony ECHO-2 Session Core do realnego OpenClaw bez przenoszenia decyzji bezpieczeństwa z kodu do promptów.

Punkt odniesienia ustalony podczas projektowania ECHO-2 to stabilny OpenClaw 2026.11.7. Plugin SDK należy traktować jako kontrakt wymagający pinowania i testów dla konkretnej wersji hosta.

## Adapter hosta musi dostarczyć

1. **Trusted caller context** z hostowych danych wykonawczych: realny agent, session/run identifiers i actor kind. Model nie otrzymuje API do tworzenia zaufanego kontekstu.
2. **Mapowanie Monitor/Viewer** na osobne agent identities i sesje.
3. **Tool policy** ograniczającą metody core według roli. Viewer nie może otrzymać narzędzi Vault/admin.
4. **Provider transport adapter**, który przed każdym fizycznym requestem zapisuje `authorizePhysicalTransport()`, a po dispatch/result aktualizuje dokładnie ten physical attempt. Odpowiedź przekazana do Session Engine musi zachować `transport_attempt_id`, żeby provenance model reply dało się związać z konkretnym fizycznym requestem.
5. **Recovery mapping**: restart hosta lub utrata Viewer context nie może tworzyć pozornego nowego kroku ani nowego targetu.
6. **Persistent store adapter** zgodny z transakcyjnymi gwarancjami ECHO-2. Jeżeli produkcyjny OpenClaw wymaga innego mechanizmu niż `node:sqlite`, musi zachować atomic acceptance/checkpoint, immutable target commit i idempotent Reveal.
7. **Trusted neutrality verifier** dla adjunct probes i Telepathy T9. Adapter nie może pozwolić modelowi dostarczyć własnego kontekstu do klasyfikacji; ECHO-2 przekazuje verifierowi kontekst blind zbudowany z trwałego stanu.
8. **Redacted tools**: pre-Reveal Monitor/Viewer widzą tylko bezpieczne projekcje danych.

## Provider retry

Najważniejszy wymóg z wcześniejszych audytów AI RV Harness: zapis nie może następować tylko raz przed logicznym krokiem. Receipt musi powstać **przed każdą fizyczną próbą transportu**, również przed retry wykonywanym wewnątrz adaptera providera. Jeśli zapis receipt się nie powiedzie, adapter nie może wykonać requestu.

## Viewer continuity

ECHO-3 ma sprawdzić empirycznie, czy wybrany mechanizm OpenClaw zachowuje wielokrokową sesję Viewera. Sam fakt istnienia subagenta nie jest wystarczający.

Każda wiadomość do Viewera powinna być związana z:

- `echo_session_id`,
- `viewer_agent_id`,
- `viewer_session_id`,
- `step_id`,
- `step_instance_id`,
- `attempt_id`.

Jeżeli host zgubi kontekst Viewera, ECHO przechodzi przez Recovery. Nie wolno po cichu udawać ciągłości.

## Krytyczne testy ECHO-3

- Monitor nie odczytuje targetu przez żadne narzędzie/history pre-Reveal.
- Viewer nie odczytuje targetu ani historii innego Viewera.
- Host nie pozwala modelowi podrobić roli/caller context.
- Każdy rzeczywisty request providera ma dokładnie odpowiadający physical transport receipt.
- Wewnętrzny provider retry także ma osobny receipt.
- Restart między receipt, dispatch, odpowiedzią i accept nie dubluje zaakceptowanego kroku.
- Concurrent Reveal zwraca jeden trwały wynik.
- Utrata Viewer session uruchamia Recovery, nie zmianę targetu.
- `no_code` nie przecieka technicznego ID.
- Human conductor i AI Monitor respektują tę samą Session Engine state machine.

## Po PASS ECHO-3

Dopiero wtedy można uznać, że bezpieczeństwo zaprojektowane w ECHO-0/ECHO-1 i zaimplementowane w ECHO-2 jest rzeczywiście przeniesione do środowiska OpenClaw.

## Owner principal i runtime events po ECHO-2 FIX

Adapter ECHO-3 musi wyprowadzać `principalId/requesterPrincipalId` z hostowych faktów tożsamości. Nie wolno przyjmować ich z argumentów narzędzia generowanych przez model. Dla zdarzenia utraty kontekstu Viewera adapter ma używać `fromRuntimeEvent()` i przekazać exact `echoSessionId`, `viewerAgentId`, `viewerSessionId` oraz unikalny event ID. Publiczne narzędzie modelu nie może otrzymać dostępu do fabryki runtime-event context.
