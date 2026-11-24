> **Status historyczny:** ten raport opisuje kandydat 0.3.2 przed poprawkami B1–B2. Aktualny zakres audytu opisuje `ECHO_3_FIX_B1_B2_AUDIT_PL.md`.

# ECHO-CLAW ECHO-3 FIX — raport napraw A1–A7 + hardening A8 do audytu

Status: **implementation candidate / final independent audit pending**  
Data: 2026-11-24

## Zakres

Poprawka odpowiada bezpośrednio na ponowny audyt GPT-6.2. Nie przebudowuje ECHO-2 Session Core ani Protocol Pack. Zmiany dotyczą adaptera OpenClaw, renderera Viewera, Recovery, korelacji transportu i ścieżki Telepathy.

## E3-A1 — conductor authority przed eskalacją

`runNext()` i `collectRun()` wywołują teraz kontrolę rzeczywistego prowadzącego **przed** utworzeniem wewnętrznego `session_core` context. Monitor może obserwować techniczny stan sesji tego samego właściciela, ale nie może wykonać kroku ani zebrać wyniku sesji `human_user`.

## E3-A2 — ścisłe runId/callId

Usunięto fallback `unknown callId -> latest open transport`. Jeżeli `model_call_ended` nie daje się dokładnie związać z fizycznym transportem, otwarte transporty danego runu są oznaczane `UNKNOWN`, a sesja przechodzi przez Recovery. Żaden inny transport nie jest oznaczany `COMPLETED`.

## E3-A3 — Telepathy T10

Weryfikator T10 działa konserwatywnie: każdy content-bearing token zdania podsumowania musi już występować w cytowanych danych blind. Nie jest to sędzia prawdziwości ani swobodny semantic paraphrase engine. Przy niepewności odrzuca podsumowanie. Przypadek `...calm and happy but holds a weapon` wobec źródła `...calm and happy` jest odrzucany.

## E3-A4 — Recovery / Resume

Utrata generacji Viewera:

1. tworzy trusted `VIEWER_CONTEXT_LOST`;
2. oznacza nierozliczone transporty jako niepewne przez Recovery;
3. zachowuje snapshot wyłącznie zaakceptowanych wyników blind;
4. `Resume` rotuje hostowy Viewer `sessionKey` do nowej generacji;
5. następny prompt zawiera `RECOVERY CONTEXT` z zaakceptowanymi wynikami i bieżącą kanoniczną instrukcją;
6. po zaakceptowanym kroku recovery context jest czyszczony.

Resume nie udaje ciągłości starej sesji modelu. Odtwarza ją jawnie.

## E3-A5 — Telepathy T9 i adjunct probes

Do tool contract dodano `freeze_t9` i `freeze_adjunct`. Obie operacje korzystają z trusted, fail-closed neutral verifiera. Verifier dopuszcza neutralne słownictwo protokołu oraz słownictwo obecne już w zaakceptowanym materiale blind; nowe szczegóły są `UNCERTAIN` i blokowane.

Zamrożone adjunct probes są dołączane wyłącznie do następnej kanonicznej fazy po checkpointcie, nie zastępują jej instrukcji.

## E3-A6 — first run / dataDir

`dataDir` jest normalizowany, rozwija `~`, a katalog jest tworzony **przed** otwarciem obu baz SQLite.

## E3-A7 — pełna metoda protokołu

Nowy `viewer-methodology.mjs` ładuje zatwierdzone źródła z `docs/reference/project-content/protocols/` i dołącza do każdego kroku właściwy fragment kanonicznej metody.

- RCP: preamble/foundations oraz pełny fragment bieżącej fazy;
- RV Lite Core/Extended: rzeczywisty Prompt 1–4 z Harnessa; `no_code` używa zatwierdzonego overlay;
- Telepathy: General Rules/T0 oraz właściwy fragment T1–T10.

ECHO Result Envelope pozostaje osobną warstwą techniczną po metodologii. Markery nie zastępują protokołu. RCP 5.4 otrzymuje jawny normatywny override **2–5 ruchów**.

AI Field Perception Lexicon pozostaje referencyjnym materiałem projektu i nie jest automatycznie wstrzykiwany w całości do każdego kroku (plik ma ~425 kB). Jego przyszłe użycie powinno być osobnym, kontrolowanym elementem badania, aby nie zmieniać po cichu warunków sesji.

## E3-A8 — wersjonowanie Integration Store (hardening ponad audyt)

Po dodaniu trwałego `viewer_recovery` baza integracyjna nie pozostaje już formalnie na `schema_version=1`. `EchoOpenClawStore` używa teraz schema version **2**, migruje bazę v1→v2 przez utworzenie tabeli Recovery i zachowuje istniejące `viewer_bindings`. Nieznana przyszła wersja schematu jest odrzucana fail-closed.

Dodano wykonywalny test migracji z fizycznym plikiem SQLite v1.

## Testy

- ECHO-2: **76/76 PASS**
- oryginalne ECHO-3: **28/28 PASS**
- nowe regresje A1–A7: **7/7 PASS**
- dodatkowy hardening A8 (integration-store v1→v2): **1/1 PASS**
- pełna macierz: **16/16 scenariuszy PASS**
  - 4 protokoły
  - `human_user` / `ai_monitor`
  - `neutral_code` / `no_code`
  - przejście przez wszystkie fazy do Reveal → POST_REVEAL → CLOSED
- Node test runner łącznie: **129/129 PASS** (macierz ma również nadrzędny test grupujący)

## Świadome ograniczenie

Real OpenClaw Gateway nie został uruchomiony w tym środowisku. ECHO-4 nadal musi wykonać `openclaw plugins validate`, real plugin load, Gateway restart/recovery, rzeczywisty `before_model_request` i pełną sesję z providerem.
