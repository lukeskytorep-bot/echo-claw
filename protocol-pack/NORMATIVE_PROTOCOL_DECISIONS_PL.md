# ECHO-1 FIX — decyzje normatywne protokołów

Data: 2026-11-23

## RCP v1.5a — Phase 5.4

W kanonicznym źródle istnieje konflikt:
- 5.4.1 określa baseline: minimum 2, maksimum 5 ruchów;
- 5.4.3 zawiera zdanie o przejściu do Phase 6 po 1–3 ruchach.

Decyzja właściciela projektu: **obowiązuje minimum 2 i maksimum 5 ruchów po aktywacji Phase 5.4**.

ECHO-CLAW nie modyfikuje historycznego pliku źródłowego. Rozstrzygnięcie jest utrwalone jako normatywna warstwa wykonawcza i objęte osobnym hashem.

## RCP v1.5a — Phase 6 extension

Jeżeli Phase 6 wykryje nowy sygnał:
- otwierany jest nowy `cycle_index`;
- wykonywana jest nowa runda Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6;
- Phase 1 nie jest powtarzana;
- każda instancja kroku ma osobny `step_instance_id`;
- `parent_step_instance_id` wskazuje Phase 6, która otworzyła nową rundę;
- domyślny limit bezpieczeństwa wynosi 3 cykle rozszerzenia;
- osiągnięcie limitu NIE oznacza BLIND_COMPLETE; sesja przechodzi do PAUSED_REQUIRES_DECISION.

## RV Lite Core

Źródłem wykonawczym Core jest aktualny AI RV Harness 0.7.14. Core jest deterministycznie wyprowadzany przez `makeCoreResource()` z zatwierdzonego Extended przez usunięcie wyłącznie obowiązkowego Deepening Movement z Promptu 3.

Zamrożone hashe:
- PL: `80a417f17029d3fe4f10a0b3af3d5fe65658ff3ce43ae23bda0d8864551377bd`
- EN: `740cebe1d2c18ef14fb66203289edf4e39dcd5cf5a5a08dbb6c9324632e8a5a2`

## Tasking no-code

ECHO-CLAW przyjmuje dokładny, wersjonowany kontrakt `target-code-presence-v1` z aktualnego Harnessa jako bazę dla RV Lite:
- Prompt 1: zamiana oczekiwania na kod na oczekiwanie na polecenie rozpoczęcia;
- Prompt 2: zamiana komunikatu z kodem na neutralne `Cel został wybrany. Rozpocznij sesję.`;
- Prompty 3 i 4 pozostają bajtowo identyczne;
- żaden zastępczy session ID/hash/pair ID nie jest pokazywany Viewerowi.
