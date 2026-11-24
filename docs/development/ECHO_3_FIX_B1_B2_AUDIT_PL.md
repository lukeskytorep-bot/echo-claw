# ECHO-CLAW ECHO-3 FIX B1–B2 — raport dla audytora

Wersja kandydata: **0.3.3**  
Zakres: wyłącznie odporność Recovery na przerwanie procesu pomiędzy Session Core i OpenClaw Integration Store. Protokoły, targety, Reveal Gate i zasady prowadzenia sesji nie zostały zmienione.

## B1 — zdarzenie utraty kontekstu nie jest już konsumowane przed Recovery

Poprzednio `runtime_event_dedup` oznaczał zdarzenie jako zapisane zanim Session Core wykonał `viewerContextLost()` i `recoverInterruptedWork()`. Awaria po zapisie identyfikatora mogła zablokować ponowienie.

W 0.3.3 każde zdarzenie ma trwały status:

`PENDING → APPLIED`

`beginRuntimeEvent()` tworzy lub odczytuje zdarzenie `PENDING`. Jeśli istnieje już niedokończone zdarzenie `VIEWER_CONTEXT_LOST` dla tej sesji, adapter wznawia właśnie je nawet wtedy, gdy host zdążył utworzyć kolejną generację Viewera. Nowy event id jest związany z utraconym bindingiem, a nie z numerem generacji zastępczej. Przy ponowieniu adapter sprawdza hash-chain audit Session Core:

- czy `VIEWER_CONTEXT_LOST` z tym samym `runtime_event_id` został już zastosowany;
- czy `INTERRUPTED_WORK_RECOVERED` dla tego samego identyfikatora został już zastosowany.

Dzięki temu restart może dokończyć operację bez ślepego powtarzania już wykonanych części. Dopiero po uzyskaniu recovery snapshotu Integration Store wykonuje jedną własną transakcję: zapisuje Recovery, czyści aktywną próbę i oznacza event `APPLIED`.

Test `E3-FIX-B1` symuluje awarię **po trwałym zapisie PENDING, ale przed zmianą Session Core**, zamyka proces, następnie zmienia obserwowaną generację Viewera jeszcze raz, otwiera obie bazy ponownie i potwierdza dokończenie tego samego Recovery bez tworzenia drugiego zdarzenia.

## B2 — Resume jest trwałą, idempotentną sagą

Poprzednio Integration Store zmieniał Viewer binding przed `core.resume()`. Awaria pomiędzy bazami mogła zostawić niespójny stan.

W 0.3.3 `viewer_recovery` przechowuje:

- `resume_status`: `NONE | PENDING | CORE_APPLIED | COMPLETE`;
- `resume_operation_id`;
- `planned_session_key`.

Przebieg:

1. Integration Store trwale zapisuje `PENDING`, operation id i planowany nowy Viewer session key.
2. Session Core wykonuje Resume.
3. Jeżeli po restarcie Session Core jest już `BLIND_RUNNING`, adapter traktuje Resume jako zastosowane i nie próbuje wykonywać go drugi raz.
4. Integration Store zapisuje `CORE_APPLIED`.
5. Integration Store atomowo rotuje Viewer binding i kończy workflow jako `COMPLETE`.

Jeżeli odpowiedź do użytkownika zginie po zakończeniu, ponowne `resume` zwraca aktualny `BLIND_RUNNING` zamiast wykonywać operację drugi raz.

Podczas `PENDING/CORE_APPLIED` inne mutacje są blokowane kodem `RECOVERY_RESUME_INCOMPLETE`; dostępne pozostają odczyt statusu i dokończenie Resume.

Test `E3-FIX-B2` wymusza awarię **po skutecznym `core.resume()`, ale przed potwierdzeniem w Integration Store**, uruchamia adapter ponownie i potwierdza bezpieczne dokończenie tej samej operacji.

## Schema v3

Integration Store przechodzi z v2 do v3. Migracja:

- dodaje status Resume i jego trwałe identyfikatory;
- dodaje `PENDING/APPLIED` do rejestru runtime eventów;
- istniejących eventów ze starego schematu nie uznaje automatycznie za zakończone. Otrzymują `PENDING`, ponieważ starszy schemat nie potrafił udowodnić, że wszystkie kroki Recovery faktycznie zostały zastosowane.

Testowane są migracje **v1→v3** oraz **v2→v3**.

## Warunek odbioru

- wszystkie wcześniejsze testy ECHO-2 i ECHO-3 pozostają zielone;
- `E3-FIX-B1` PASS;
- `E3-FIX-B2` PASS;
- migracja v2→v3 PASS;
- 16/16 pełnych symulowanych sesji wszystkich czterech protokołów pozostaje PASS;
- manifest SHA-256 oraz baseline pozostają zgodne.

Realny OpenClaw Gateway nadal pozostaje bramką ECHO-4 i nie jest deklarowany jako zweryfikowany w tej paczce.
