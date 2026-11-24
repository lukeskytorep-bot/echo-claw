# ECHO-2: granice zaufania i bezpieczeństwa

## Zasada nadrzędna

Model nie jest źródłem autoryzacji. Tekst modelu nie może sam sobie nadać roli, zmienić targetu, ominąć checkpointu, zatwierdzić Revealu ani zadeklarować sondy jako neutralnej.

## Role

- `session_core`: zaufany rdzeń wykonawczy,
- `admin`: zaufany operator techniczny,
- `human_user`: właściciel/użytkownik prowadzący,
- `ai_monitor`: Monitor bez dostępu do pełnego targetu pre-Reveal,
- `echo_viewer`: Viewer związany z konkretną sesją.

Każdy `EchoSessionEngine` wymaga konkretnej instancji `execution authority`. Authority tworzy konteksty jako capability objects związane prywatnym tokenem z tą jedną instancją. Kontekst utworzony przez inną authority, nawet z identycznym `agentId` i rolą, jest odrzucany jako `UNTRUSTED_CONTEXT`. W ECHO-3 obiekt authority i jego `fromHostFacts()` należą wyłącznie do zaufanego adaptera hosta i nie mogą być wystawione jako narzędzie modelu.


## Właściciel sesji i izolacja principalu

Każda sesja utworzona z kontekstu użytkownika lub agenta działającego na rzecz użytkownika zapisuje `owner_principal_id` pochodzące z zaufanych faktów hosta. Pole nie jest parametrem modelu i jest niezmienne po utworzeniu sesji.

- `human_user` musi mieć `principalId` równe właścicielowi sesji.
- `ai_monitor` i `echo_viewer` muszą mieć `requesterPrincipalId` równe właścicielowi.
- brak `owner_principal_id` nigdy nie jest wildcardem: taki rekord ma status logiczny `UNBOUND_LEGACY` i jest niedostępny dla zwykłych Human/Monitor/Viewer/runtime contexts.
- nowe sesje muszą mieć trusted owner/requester principal; globalny automat dostaje jawny principal systemowy zamiast `null`.
- `session_core` i `admin` są rolami uprzywilejowanymi.
- zwykły widok sesji nie ujawnia `owner_principal_id`.

To chroni również przed sytuacją, w której dwa konta używają tego samego logicznego `agentId`.

## Zaufane zdarzenia runtime

`VIEWER_CONTEXT_LOST` nie jest decyzją prowadzącego. Metoda `viewerContextLost()` przyjmuje wyłącznie capability context utworzony przez zaufany adapter hosta przez `fromRuntimeEvent()`. Zdarzenie musi być związane z dokładnym ECHO session ID, Viewer agent ID i Viewer session ID. Monitor lub użytkownik nie mogą zastąpić takiego dowodu własnym wywołaniem.

## Informacja o targetach

Przed Reveal pełny target może znać wyłącznie core/admin. Publiczny widok dla Monitor/User/Viewer redaguje target ID, rewizję i hash. Sam fakt istnienia commitu może być widoczny jako boolean.

Wewnętrzne nazwy takie jak `long-0001` mogą zdradzać kategorię, dlatego są traktowane jako dane Vault i nie są ujawniane przed Reveal.

## Dobór targetu

Blind AI Monitor nie może podać konkretnego `target_id`. Losowanie odbywa się po stronie core z uwzględnieniem exposure history i wymaganej klasy `public/private`.

Użytkownik może wybrać konkretny target wyłącznie wtedy, gdy sesja nie deklaruje `human_blindness=BLIND`. Ręczny wybór konkretnego targetu wymaga `USER_KNOWN` albo `PARTIALLY_KNOWN`. Dla `BLIND` dobór pozostaje po stronie core.

## Transport providera

ECHO-2 nie wykonuje sieci. Każdy przyszły physical call ma sekwencję:

`logical attempt -> durable transport authorization receipt -> external dispatch -> durable dispatch/result status`.

Zapis receipt jest fail-closed. Nie ma receipt, nie ma requestu.

Po awarii wynik transportu może być `UNKNOWN`. System nie może udawać, że call na pewno nie nastąpił, jeżeli tego nie potrafi udowodnić.

Odpowiedź providera jest wiązana z konkretnym `transport_attempt_id`. Logical attempt nie może zaakceptować odpowiedzi tylko dlatego, że inny transport w tej samej próbie zakończył się sukcesem. Jednocześnie rdzeń blokuje dwa fizyczne transporty lecące równolegle dla jednego logical attempt.

## Reveal

Autoryzacja Revealu nie zawiera targetu w widoku prowadzącego. Target pojawia się dopiero po trwałym commit Revealu. Idempotency key wiąże ponowienie z tą samą operacją i tym samym target commitem.

## Adjuncts i Telepathy T9

Neutralność nie jest polem deklarowanym przez Monitor lub Viewer. Produkcyjny verifier musi działać w zaufanej warstwie. Wyniki `TARGET_AWARE` i `UNCERTAIN` blokują wysłanie sondy.

Kontekst używany przez verifier jest konstruowany wewnątrz Session Engine z trwałych danych blind. Caller nie może podstawić własnego `blindContext`, np. z target ID lub tytułem. Verifier może otrzymać protokół, tasking mode, bieżący krok i wcześniejsze zaakceptowane odpowiedzi, ale nie sealed target.

## Audit trail

Audit event przechowuje rolę aktora, event i payload połączony łańcuchem hashy. Pre-Reveal payload jest chroniony przed prowadzącym, ponieważ sama telemetria mogłaby zawierać target identity.

## Znane granice ECHO-2

ECHO-2 nie dowodzi jeszcze bezpieczeństwa procesu pluginu OpenClaw, uprawnień systemu plików, izolacji procesu ani hostowych tool policies. To musi zostać przetestowane na realnym hoście w ECHO-3. ECHO-2 dowodzi semantyki rdzenia, gdy otrzymuje prawdziwy trusted context.
