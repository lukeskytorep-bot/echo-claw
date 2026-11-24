# ECHO-CLAW ECHO-2: Session Engine, Vault, Reveal Gate i trwały stan

Status: **kandydat do audytu ECHO-2**

## 1. Cel etapu

ECHO-2 implementuje część systemu, która nie może zależeć od pamięci lub dobrej woli modelu. Protokół pozostaje warstwą poznawczą Viewera, natomiast kod kontroluje dostęp do targetu, legalność przejść, kompletność odpowiedzi, checkpointy, retry, trwałość, Recovery i Reveal.

ECHO-2 nie jest jeszcze pluginem OpenClaw. Granica jest celowa: najpierw audytujemy semantykę rdzenia, a dopiero w ECHO-3 podłączamy ją do realnego hosta, sesji agenta i transportu providera.

## 2. Zatwierdzona baza

Rdzeń przypina cztery protokoły zatwierdzone w ECHO-1:

| Protokół | Wersja | SHA-256 manifestu |
|---|---:|---|
| RCP | 1.5a | `f2830af887ad01f4082357914f554e633d5ef2b56748af0ffca5f05d4cfd01d6` |
| RV Lite Core | 1.1.0 | `70438184e56b36cfc2cff1bf37070c9f91e64780f8abb23a74940b9ddefff3f4` |
| RV Lite Extended | 1.1.0 | `0dd2ebd697ae3c96bb7b27a67ffecf57d9fb08b9cfe4b9465cc1dea310883919` |
| Telepathy | 1.1 | `1a09d2efacbf69a11ef90ec9508fcfef3328ff4d0088e83901937e33c0947ea5` |

Execution overlay `echo-tasking-v1` jest przypięty hashem `261e835bb76704ff6f4e966616284b3e1bd51e905cfb7207015d046f48e9bb3d`.

Każda sesja zapisuje protokół, wersję, hash manifestu, overlay, hash overlay, język, conductor mode, tasking mode i klasy ślepoty. Zmiana plików po rozpoczęciu sesji nie zmienia tożsamości istniejącej sesji.


## 2A. Własność sesji

Sesja przechowuje `owner_principal_id` wyprowadzony z zaufanego kontekstu hosta. Nie jest to wartość przyjmowana z promptu ani argumentu modelu. Wszystkie nieuprzywilejowane operacje sesyjne są ograniczone do właściwego principalu. To samo wiązanie dotyczy Monitor/Viewera poprzez `requesterPrincipalId`, aby identyczny `agentId` w innym kontekście użytkownika nie dawał dostępu.

`owner_principal_id` jest SQLite-immutable i nie jest ujawniany w zwykłym widoku sesji. `NULL` nie oznacza sesji globalnej: rekord po migracji bez możliwego do udowodnienia właściciela jest logicznie `UNBOUND_LEGACY` i fail-closed dla Human/Monitor/Viewer/runtime. Nowe sesje wymagają jawnego trusted owner/requester principal; automatyzacja systemowa używa osobnej tożsamości systemowej.

Techniczne `VIEWER_CONTEXT_LOST` jest osobnym zdarzeniem runtime, a nie komendą Monitora. Zaufany host musi dostarczyć event ID oraz dokładne wiązania ECHO session / Viewer agent / Viewer session.

## 3. Trwała maszyna stanu

Stan sesji jest zapisywany w SQLite. Obsługiwane stany:

`CREATED -> TARGET_RESERVED -> TARGET_COMMITTED -> VIEWER_READY -> BLIND_RUNNING`

Podczas pracy mogą wystąpić:

`PAUSED`, `RECOVERING`, `PAUSED_REQUIRES_DECISION`, `CANCELLED`, `FAILED`.

Po formalnym zakończeniu blind:

`BLIND_COMPLETE -> REVEAL_AUTHORIZED -> REVEALING -> REVEALED -> POST_REVEAL -> CLOSED`.

`REVEALING` występuje wewnątrz transakcji Revealu. Nie jest traktowany jako stan, na którym zewnętrzny model może oprzeć własną decyzję o ujawnieniu targetu.

## 4. Target Vault i commit

Target istnieje w tabeli `targets` jako wersjonowany rekord `target_id + revision + sha256 + content`. Sesja najpierw rezerwuje target, a następnie go commituję. Po `TARGET_COMMITTED` jego `target_id`, `target_revision`, `target_sha256` i `target_committed_at` są niezmienne także na poziomie triggerów SQLite.

Przed Reveal Monitor, Viewer i użytkownik prowadzący otrzymują zredagowany widok sesji. Nie widzą `target_id`, rewizji ani hasha. Monitor nie może wybrać konkretnego `target_id` w sesji blind. Może poprosić wyłącznie o losowy, kwalifikujący się target. Użytkownik z `human_blindness=BLIND` również nie może ręcznie wskazać konkretnego `target_id`. Jawny wybór targetu przez użytkownika wymaga `USER_KNOWN` albo `PARTIALLY_KNOWN`; zaufany core może wykonywać operacje administracyjne bez ujawniania targetu prowadzącemu.

## 5. Tasking

Dwa tryby pozostają zgodne z ECHO-1:

- `neutral_code`: losowy semantycznie pusty kod niezależny od targetu,
- `no_code`: brak zastępczego identyfikatora dla Viewera.

Wewnętrzne `session_id`, `target_id` i hashe nie stają się substytutem kodu w `no_code`.

## 6. Attempt Registry i transport

ECHO-2 rozdziela:

- **logical attempt**: jedna próba wykonania konkretnego `step_instance`,
- **physical transport attempt**: konkretne wywołanie providera w ramach logical attempt.

Przed każdym przyszłym fizycznym wywołaniem ECHO-3 musi wywołać `authorizePhysicalTransport()`. Funkcja najpierw zapisuje receipt. Dopiero po poprawnym zapisie wolno adapterowi wykonać request sieciowy. Jeżeli zapis nie powiedzie się, transport jest niedozwolony.

Wiele fizycznych retry może należeć do jednego logical attempt, ale tylko jedna fizyczna próba może być równocześnie w locie. Po zakończonym fizycznym callu nie wolno po cichu tworzyć następnego transportu pod tym samym logical attempt bez właściwej ścieżki retry/recovery. Jeden `step_instance` może mieć maksymalnie jeden zaakceptowany wynik.

Każda odpowiedź modelu musi wskazywać dokładny `transport_attempt_id`, który ją wytworzył. Akceptowany `step_result` utrwala to samo provenance. Nie wystarcza fakt, że dowolny transport należący do logical attempt kiedyś zakończył się sukcesem.

Po restarcie transport o niepewnym losie otrzymuje `UNKNOWN`. Dotyczy to także receipt `AUTHORIZED`, jeżeli z perspektywy rdzenia nie można dowieść, że zewnętrzny adapter nie wykonał requestu tuż przed awarią. Recovery nie tworzy automatycznie nowego logical attempt.

## 7. Walidacja i checkpointy

Odpowiedź jest walidowana przez port kontraktów ECHO-1 FIX3. Sam tekst typu „wykonałem sześć dotyków” nie kończy kroku. Struktura musi spełnić wymagania protokołu.

Zaakceptowanie wyniku i przejście stanu są jedną transakcją. Jeżeli krok ma checkpoint, wynik zostaje zapisany, ale kolejny krok nie może rozpocząć się przed legalnym `continueCheckpoint()` prowadzącego.

RCP Phase 6 używa `cycle_index`. `NEW_SIGNAL` otwiera następną rundę od Phase 2. Po osiągnięciu limitu rund sesja przechodzi do `PAUSED_REQUIRES_DECISION` i nie robi automatycznego Reveal.

## 8. Telepathy T9

Pytania T9 są zamrażane trwale przy checkpointcie T8. Każde pytanie musi przejść zaufaną kontrolę neutralności. T9 nie ufa liczbie pytań przekazanej przez model lub adapter. Walidator pobiera wymaganą liczbę wyłącznie z trwałego stanu sesji.

Neutrality verifier nie otrzymuje od wywołującego dowolnego `blindContext`. Rdzeń sam buduje kontekst z trwałego stanu blind: protokołu, tasking mode, bieżącego kroku i wcześniej zaakceptowanych wyników. Kontekst nie zawiera target identity ani feedbacku.

## 9. Reveal Gate

Reveal wymaga:

- stanu `BLIND_COMPLETE`,
- istniejącego immutable target commit,
- braku otwartych prób,
- legalnego prowadzącego lub core,
- trwałej autoryzacji,
- zgodnego `idempotency_key`.

Autoryzacja zwracana Monitorowi/użytkownikowi nie zawiera target identity. Właściwy target jest zwracany dopiero przez udany, trwale zapisany `executeReveal()`.

Reveal jest idempotentny. Ten sam klucz zwraca ten sam wynik także po restarcie i przez drugie połączenie z bazą. Inny klucz po istniejącej autoryzacji jest odrzucany. Błąd persistence przed commitem nie ujawnia targetu.

## 10. Historia ekspozycji

Ekspozycja jest zapisywana per `target_id + viewer_agent_id`. Po Reveal target staje się `KNOWN_TO_VIEWER` dla konkretnego Viewera i jest wyłączany z przyszłych zwykłych sesji blind tego Viewera. Inny Viewer zachowuje własną historię.

`KNOWN_TARGET_TRAINING` może celowo użyć znanego targetu, ale nie jest traktowany jako świeży niezależny blind trial.

## 11. Audit trail

Zdarzenia są zapisywane w łańcuchu hashy. Pełny audit payload jest zamknięty przed Reveal dla Monitor/User conductor, aby historia techniczna nie stała się kanałem przecieku targetu. Integralność łańcucha może być sprawdzona bez ujawniania payloadu. Po Reveal pełny audyt staje się dostępny zgodnie z rolą.

## 12. Biblioteka targetów

Pakiet zawiera komplet 126 targetów ze starego ECHO-CLAW:

- 35 long,
- 34 short/activity,
- 45 short/location,
- 12 telepathic.

Wszystkie są zachowane. Dodatkowo runtime obsługuje targety `private`, które nie muszą istnieć w publicznym repo i mogą być używane w badaniach wymagających silniejszej metodologicznej ślepoty.

Osobny sanity audit znajduje się w `TARGET_LIBRARY_SANITY_AUDIT_PL.md`.

## 13. Co pozostaje do ECHO-3

ECHO-3 ma dostarczyć adapter OpenClaw, który:

1. tworzy trusted caller context wyłącznie z faktów dostarczonych przez hosta,
2. mapuje realne sesje Monitor/Viewer na `viewer_session_id`,
3. wykonuje provider call dopiero po trwałym pre-dispatch receipt,
4. zachowuje fizyczne retry jako osobne transport attempts,
5. implementuje produkcyjny neutrality verifier w zaufanej warstwie,
6. podłącza persistent store bez osłabienia transakcji ECHO-2,
7. nie udostępnia modelom surowego Vault ani administracyjnych metod core.

## 14. Warunek odbioru ECHO-2

Kandydat po poprawce autoryzacji jest gotowy do audytu przy 76/76 testach lokalnych. Finalny PASS ECHO-2 powinien zostać przyznany dopiero po niezależnym uruchomieniu testów, sprawdzeniu manifestu SHA-256 i dodatkowych testach negatywnych audytora.
