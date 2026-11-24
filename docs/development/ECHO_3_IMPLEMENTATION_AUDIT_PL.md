> **HISTORYCZNY RAPORT ECHO-3 0.3.0.** Ten dokument opisuje stan przed audytem GPT-6.2. Aktualny kandydat do audytu znajduje się w `ECHO_3_FIX_A1_A8_AUDIT_PL.md`.

> **Nota historyczna ECHO-4:** ten dokument opisuje stan ECHO-3 w momencie jego budowy. Wzmianka niżej o Node 22.22.3 została zastąpiona w ECHO-4 bieżącą polityką hosta: Node `>=24.16.0 <25 || >=26.1.0 <27`. Bieżącym źródłem wymagań jest `docs/openclaw/ECHO_4_INSTALLATION_PL.md`.


# ECHO-CLAW ECHO-3 - raport implementacji do audytu

Status: **implementation candidate / independent audit pending**  
Data: 2026-11-24

## 1. Cel etapu

ECHO-3 łączy zaakceptowany ECHO-2 Session Core z natywnym środowiskiem OpenClaw bez przenoszenia reguł bezpieczeństwa z powrotem do promptów.

Rdzeń ECHO-2 pozostaje autorytetem dla:

- właściciela sesji;
- conductor mode;
- dozwolonych przejść stanu;
- blind target isolation;
- attempt/physical transport history;
- checkpointów;
- Reveal Gate;
- Recovery/Cancel/Resume;
- target exposure history.

Adapter OpenClaw dostarcza wyłącznie zaufane fakty hosta, Viewer transport i powierzchnie narzędzi.

## 2. Zaimplementowane elementy

### Native plugin

Dodano:

- `openclaw.plugin.json`;
- `dist/index.js`;
- `src/openclaw/plugin-definition.mjs`;
- `src/openclaw/adapter.mjs`;
- `src/openclaw/integration-store.mjs`;
- `src/openclaw/prompt-renderer.mjs`.

Target zgodności: **OpenClaw 2026.11.7**. Zakres package/plugin API jest przypięty do `>=2026.11.7 <2026.12.0`.

### Rozdzielenie ról hosta

Domyślnie:

- `main` = owner-facing agent, może otrzymać `echo_owner_session` tylko przy hostowym `senderIsOwner=true` i zaufanym `requesterSenderId`;
- `echo-monitor` = blind AI Monitor, może otrzymać tylko `echo_monitor_session`;
- `echo-viewer` = Viewer, nie otrzymuje narzędzi; każdy ECHO Viewer run używa dodatkowo `disableTools:true`.

Monitor nie może pożyczyć owner tool nawet wtedy, gdy jego turn pochodzi od właściciela.

### Persistent Viewer

Każda sesja ECHO otrzymuje deterministyczny plugin-owned Viewer `sessionKey`, niezawierający danych targetu.

Viewer jest uruchamiany przez `api.runtime.subagent.run(...)` z:

- `promptMode: "minimal"`;
- `disableTools: true`;
- `deliver: false`;
- przekazanym `assertCurrent`.

Po pierwszym uruchomieniu zapisywane są hostowe `sessionId` i `lifecycleRevision`. Zmiana lub utrata generacji Viewera prowadzi do zaufanego `VIEWER_CONTEXT_LOST` i stanu `RECOVERING`.

### Fizyczny provider transport

Dla rozpoznanej sesji Viewera hook `before_model_request` musi przed dispatch zapisać trwały fizyczny receipt w Session Core.

Następnie:

1. core `authorizePhysicalTransport()` zapisuje receipt;
2. core oznacza go `DISPATCHED`;
3. integration store zapisuje korelację z Viewer session/run;
4. `model_call_started` wiąże `callId`;
5. `model_call_ended` kończy transport jako `COMPLETED` albo `FAILED`.

Viewer response nie może zostać zaakceptowana bez durably `COMPLETED` physical receipt.

Retry po `FAILED`/`UNKNOWN` jest możliwe w jednym logical attempt. Zachowano silniejszy kontrakt ECHO-2 T65: po `COMPLETED` drugi provider dispatch w tym samym logical attempt jest fail-closed.

### Fail closed

- brak aktywnego logical attempt przy provider request -> blokada;
- brak `before_model_request` evidence po zakończeniu Viewer run -> `RECOVERING`;
- Viewer generation mismatch -> `RECOVERING` przed następnym provider send;
- owner/Monitor principal mismatch -> odmowa przez Session Core;
- owner tool wewnątrz AI Monitor agent -> niewidoczne/niedostępne.

## 3. Trwały integration store

Osobna SQLite DB przechowuje:

- Viewer binding;
- owner principal binding;
- OpenClaw Viewer `sessionKey`;
- host `sessionId` / `lifecycleRevision`;
- aktywny logical attempt / run / step instance;
- powiązania physical transport ↔ run ↔ call;
- deduplikację runtime eventów.

Dane te przeżywają reopen pluginu i nie zastępują Session Core jako autorytetu sesji.

## 4. Prompt/Result boundary

Renderer generuje per-step prompt zgodny z zatwierdzonym Protocol Pack i markerami ECHO Result Envelope. Nie przekazuje target identity ani target content przed Reveal.

Wariant `no_code` nie emituje `SESSION_CODE`, pseudo-kodu ani komunikatu o oczekiwaniu na kod.

Telepathy T10 korzysta z deterministycznego, konserwatywnego support verifiera. Jest to mechanizm kompletności/provenance, nie ocena prawdziwości telepatii.

## 5. Testy

Pełny lokalny wynik:

- **ECHO-2: 76/76 PASS**;
- **ECHO-3: 28/28 PASS**;
- **łącznie: 104/104 PASS**;
- baseline: **4 protokoły + overlay + 126 targetów PASS**.

Najważniejsze ECHO-3 regresje obejmują:

- zaufany owner/Monitor context;
- brak model-authored authority fields;
- target redaction;
- pre-dispatch transport receipt;
- provider retry po błędzie;
- brak dispatch po failure receipt write;
- empty Viewer tool surface;
- persistent Viewer `sessionKey`;
- lifecycle generation loss;
- owner i Monitor cross-principal isolation;
- conductor separation;
- `no_code` renderer;
- uncontrolled Viewer provider request;
- missing hook proof;
- `assertInvocationCurrent`;
- trwałość integration store;
- blokadę drugiego provider dispatch po `COMPLETED`;
- trwałość active run/attempt po reopen;
- pin OpenClaw 2026.11.7;
- blokadę owner tool w AI Monitor agent.

Dowód: `docs/development/integrity/TEST_RESULTS_ECHO3.txt`.

## 6. Ważne ograniczenie audytu lokalnego

Ten build container ma Node `22.16.0` i **nie ma zainstalowanego OpenClaw CLI/Gateway**. OpenClaw 2026.11.7 wymaga wspieranej wersji Node, a pakiet ECHO deklaruje floor `22.22.3` na linii Node 22.

Dlatego:

- testy ECHO-2 są realnymi testami Session Core;
- testy ECHO-3 są wykonywalnymi testami integracji na contract-faithful mock host;
- `node --check` weryfikuje lokalną składnię entry/adaptera;
- **nie twierdzimy**, że plugin został załadowany przez prawdziwy Gateway w tym środowisku;
- `openclaw plugins validate`, real `before_model_request` smoke i real provider call są gate ECHO-4.

To ograniczenie jest zapisane również w `docs/openclaw/OPENCLAW_2026_11_7_COMPATIBILITY.md` oraz `docs/development/integrity/OPENCLAW_LIVE_VALIDATION_STATUS.txt`.

## 7. Oficjalne kontrakty OpenClaw użyte przy implementacji

Sprawdzono publiczną dokumentację OpenClaw dotyczącą:

- tool plugins / v2 tool context;
- `assertInvocationCurrent`;
- subagent runtime;
- `captureSessionGeneration`;
- `before_model_request`;
- `model_call_started` / `model_call_ended`;
- plugin manifest/config;
- `agents.entries` i per-agent tool policy;
- Node runtime requirements.

Lista URL znajduje się w `docs/openclaw/OPENCLAW_2026_11_7_COMPATIBILITY.md`.

## 8. Co szczególnie powinien sprawdzić audytor

1. Czy `echo_owner_session` może pojawić się poza skonfigurowanym owner-facing agentem.
2. Czy Monitor może w dowolny sposób uzyskać owner authority albo full target przed Reveal.
3. Czy `before_model_request` receipt rzeczywiście jest fail-closed przy błędzie zapisu.
4. Czy korelacja `runId/callId/transport_attempt_id` ma przypadki pomyłki przy retry.
5. Czy plugin restart/reopen może zaakceptować odpowiedź bez właściwego transport proof.
6. Czy `assertInvocationCurrent` jest używany wystarczająco blisko efektów po await.
7. Czy config example odpowiada rzeczywistemu schema OpenClaw 2026.11.7.
8. Czy `dist/index.js` i manifest/package metadata są akceptowalne przez prawdziwe `openclaw plugins validate`.
9. Czy konserwatywne ograniczenie „brak drugiego dispatch po COMPLETED” jest poprawnie zachowane w host integration.
10. Czy unsupported external harness/cloud-worker paths są faktycznie fail-closed, a nie tylko opisane w dokumentacji.

## 9. Rekomendowany warunek PASS ECHO-3

ECHO-3 może dostać finalny PASS architektoniczno-implementacyjny po niezależnym audycie kodu i 104 testów.

**Real Gateway smoke nie powinien być fałszywie dopisywany do ECHO-3, jeśli nie został wykonany.** Po PASS ECHO-3 należy przejść do ECHO-4, zainstalować wspierany OpenClaw 2026.11.7 na zgodnym Node i wykonać plugin validate/load, Gateway restart/recovery oraz pełną ślepą sesję testową.
