# Sanity audit biblioteki 126 targetów

## Wynik

**Wszystkie 126 targetów pozostają w bibliotece.** Nie znaleziono powodu do usunięcia któregokolwiek celu na etapie ECHO-2.

Sprawdzono nazwy plików, pierwsze nagłówki, typowe pozostałości robocze, URL-e i sformułowania związane z obrazami/fotografiami.

## Rzeczy wymagające porządku, ale nie usunięcia targetu

### 1. `long/target_0011_.md`

Nazwa ma dodatkowy znak `_` przed `.md`. Nagłówek wewnątrz jest poprawny: `Target 0011`.

Rekomendacja na finalny clean source: zmienić nazwę na `target_0011.md` i zaktualizować katalog/hash/provenance w jednym kontrolowanym commicie.

### 2. `short/location/target_0042.md`

Plik nazywa się `target_0042.md`, ale pierwszy nagłówek brzmi `# Target 0041`.

Nie poprawiano tego automatycznie, ponieważ zmiana nagłówka lub nazwy zmieni provenance i hash. Przed finalnym release trzeba świadomie rozstrzygnąć, czy poprawny numer to 0041 czy 0042. Z punktu widzenia treści sam target pozostaje dopuszczony.

### 3. Pięć not redakcyjnych przy szkicach

Poniższe pliki mają uwagę w rodzaju „ASCII map is a simplified illustrative sketch based on photographic data”:

- `long/target_0027.md`
- `long/target_0029.md`
- `long/target_0030.md`
- `short/activity/target_0034A.md`
- `short/location/target_0044L.md`

To nie są śmieci techniczne ani instrukcje dla modelu przed Reveal. Są częścią feedbacku, ale stylistycznie wyglądają jak noty redakcyjne. W finalnym clean source można je uprościć do neutralnej informacji, że szkic jest orientacyjny i nie jest w skali. Nie należy zmieniać samego targetu ani geometrii szkicu.

## Wzmianki o image/photo

W 11 plikach występują słowa `image`, `photo`, `photograph`, `photographic` lub `images` w obecnym skanie słownikowym. Po przeglądzie większość jest zwykłą częścią opisu wydarzenia, fotografowania lub materiału feedbackowego. Nie należy usuwać ich automatycznie na podstawie samego słowa.

## Rysunki i szkice

Poprzednia rygorystyczna lista ECHO-1 wskazywała 59 targetów z jawnym określeniem szkicu i blokiem kodowym. Obecny katalog ECHO-2 oznacza **60** rekordów jako `has_ascii_feedback=true`, ponieważ `short/activity/target_0030A.md` zawiera rzeczywisty ASCII layout, ale nie jest opakowany takim samym blokiem kodowym jak kandydaci z poprzedniego skanu.

To nie oznacza dodania nowego targetu. Nadal istnieje 126 targetów. Różnica 59/60 dotyczy wyłącznie metadanej „ma szkic”. `target_0030A.md` powinien pozostać oznaczony jako posiadający ASCII feedback, ponieważ taki szkic faktycznie znajduje się w pliku.

## Pozostałe wyniki

Nie wykryto URL-i `http://` lub `https://`. Nie wykryto jawnych placeholderów typu `TBD`, `FIXME`, `PLACEHOLDER` lub `lorem ipsum`. Nie znaleziono literalnego śmieciowego wpisu `Target 100`.

## Decyzja ECHO-2

- zachować 126/126 targetów,
- zachować 60 aktualnie wykrytych targetów z ASCII feedback,
- nie dokonywać cichej korekty treści lub numeracji w paczce audytowej,
- dwie korekty nazewnictwa i pięć not redakcyjnych potraktować jako cleanup przed finalnym clean-branch complete source po PASS ECHO-2.
