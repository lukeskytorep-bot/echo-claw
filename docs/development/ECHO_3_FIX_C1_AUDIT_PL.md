# ECHO-CLAW ECHO-3 FIX C1 — nota do audytu

Wersja kandydata: **0.3.4**  
Data: **2026-11-24**

## Zakres

Ta poprawka dotyczy wyłącznie przypadku awarii, w którym Integration Store zdążył trwale zapisać `VIEWER_CONTEXT_LOST` jako `PENDING`, Session Core zdążył już przejść do `RECOVERING` i wykonać `recoverInterruptedWork()`, ale proces został przerwany przed zapisaniem recovery snapshotu oraz przed zmianą zdarzenia na `APPLIED`.

Nie zmieniono Protocol Pack, targetów, Reveal Gate, transportu ani schematu Integration Store. Schemat pozostaje **v3**.

## Poprawka

Adapter ma teraz jawny etap reconciliation dla oczekującego `VIEWER_CONTEXT_LOST`. Jeśli Session Core posiada już trwały audit `VIEWER_CONTEXT_LOST` z tym samym `runtime_event_id`, operacja nie jest wykonywana ponownie. Analogicznie `INTERRUPTED_WORK_RECOVERED` jest wykonywane tylko wtedy, gdy brak odpowiadającego wpisu audytowego. Następnie adapter pobiera aktualny blind recovery context z Session Core i atomowo w Integration Store:

1. zapisuje recovery snapshot,
2. czyści wyłącznie odpowiadający aktywny attempt binding,
3. zmienia runtime event `PENDING → APPLIED`.

`recoverViewerContext()` zawsze wykonuje reconciliation przed rozpoczęciem sagi Resume. `runNext()` w stanie `RECOVERING` również może dokończyć osierocone zdarzenie i zwraca kontrolowany status `RECOVERING`, zamiast kończyć się `ILLEGAL_STATE`.

## Regresja E3-FIX-C1

Test wymusza awarię dokładnie po trwałym wejściu Session Core w `RECOVERING` i po `recoverInterruptedWork()`, ale przed `completeViewerContextLossEvent()`. Następnie:

- zamyka obie bazy,
- uruchamia nowy adapter,
- potwierdza dokończenie `PENDING → APPLIED`,
- potwierdza zapis recovery snapshotu,
- wykonuje drugi restart,
- wykonuje Resume do `BLIND_RUNNING`,
- potwierdza zachowanie wcześniej zaakceptowanego blind step,
- potwierdza dokładnie jeden `VIEWER_CONTEXT_LOST`, jeden odpowiadający mu `INTERRUPTED_WORK_RECOVERED` i jeden `SESSION_RESUMED`.

## Oczekiwany wynik

Pełny zestaw powinien przechodzić **133/133 PASS**. Realny OpenClaw Gateway pozostaje osobnym gate ECHO-4.

## Finalna weryfikacja kandydata

- `npm test`: **133/133 PASS**
- `npm run verify:baselines`: **PASS — 4 protokoły, execution overlay, 126 targetów**
- syntax-check: **21/21 modułów JavaScript PASS**
- `PACKAGE_MANIFEST_SHA256.txt`: generowany po finalizacji wszystkich plików i weryfikowany ponownie z gotowego ZIP-a
- test z gotowego, świeżo rozpakowanego ZIP-a: **133/133 PASS**
