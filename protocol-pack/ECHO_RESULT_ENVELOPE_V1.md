# ECHO Result Envelope v1.1

Canonical protocol content is not replaced. The execution renderer appends a machine-readable formatting request appropriate to the current step.

Markers are part of the execution profile, not the canonical protocol source.

## General
- Each required section begins with an exact `[[ECHO:...]]` marker. Any marker-like token is parsed as structure first; malformed/lowercase/unknown marker syntax is rejected rather than absorbed into payload.
- For structured validators, all response content must be bound to a recognized marker. Non-whitespace text before the first marker is rejected.
- Payload belongs to the immediately preceding marker and continues until the next marker.
- Required data-bearing blocks must contain non-empty payload. A bare marker is not evidence of observation.
- An explicit protocol-faithful response such as `brak sygnału`, `no signal`, `nothing perceived` is valid payload. The validator must never force invented data.
- Container/state markers explicitly documented as payload-free may remain empty, e.g. touch anchors and `STEP3:EXHAUSTED`.
- Marker order is normative for the execution envelope. Reordering markers or placing descriptors outside their parent touch/question is rejected.
- A declaration such as “step complete” does not count as evidence.

## RCP Phase 1
For each N=1..6, in this exact order:

`[[ECHO:RCP:TOUCH:N]]`

followed by five data-bearing fields bound to that touch:

`[[ECHO:ECHO_DOT]]`
`[[ECHO:CONTACT_CATEGORY]]`
`[[ECHO:PRIMITIVE_DESCRIPTOR]]`
`[[ECHO:ADVANCED_DESCRIPTOR]]`
`[[ECHO:FORMING]]`

The touch marker is an anchor. Each of the five fields must contain payload.

## RCP Phase 2–4
Exact order, each with non-empty payload:

`[[ECHO:RCP:RAPID_CONTACT]]`
`[[ECHO:RCP:VECTOR_ORBIT]]`
`[[ECHO:RCP:FUNCTIONAL_SKETCH]]`

## RCP Phase 5
Exact base sequence, each with non-empty payload:

`[[ECHO:RCP:5.1]]`
`[[ECHO:RCP:5.2:T1]]`
`[[ECHO:RCP:5.2:T2]]`
`[[ECHO:RCP:5.2:T3]]`
`[[ECHO:RCP:5.3]]`

Phase 5.4 is optional. If activated, each move uses:

`[[ECHO:RCP:5.4:MOVE:N]]`

N must form an ordered contiguous sequence 1..N, and the move count must be 2–5. Every move must contain payload.

## RCP Phase 6
Exactly one outcome marker:

`[[ECHO:RCP:6:NO_NEW_SIGNAL]]`

or

`[[ECHO:RCP:6:NEW_SIGNAL]]`

The outcome marker is itself the state evidence and **must be payload-free**. Any additional descriptive text after the marker is rejected.

## RV Lite Steps 1–2
For each touch N=1..6, exact order:

`[[ECHO:RVL:TOUCH:N]]`
`[[ECHO:RVL:ECHO_DOT]]`
`[[ECHO:RVL:PRIMITIVE_DESCRIPTOR]]`
`[[ECHO:RVL:ADVANCED_DESCRIPTOR]]`
`[[ECHO:RVL:CONTACT_CATEGORY]]`
`[[ECHO:RVL:FORMING]]`

The five fields under every touch must contain payload.

Then three data-bearing vectors in exact order:

`[[ECHO:RVL:VECTOR:1]]`
`[[ECHO:RVL:VECTOR:2]]`
`[[ECHO:RVL:VECTOR:3]]`

Then three data-bearing ASCII sketches in exact order:

`[[ECHO:RVL:SKETCH:1]]`
`[[ECHO:RVL:SKETCH:2]]`
`[[ECHO:RVL:SKETCH:3]]`

## RV Lite Step 3 Core
Exact order:

`[[ECHO:RVL:STEP3]]`
`[[ECHO:RVL:STEP3:EXHAUSTED]]`

`STEP3` must contain the deepening-loop output, or an explicit no-signal/exhaustion statement. `STEP3:EXHAUSTED` is a state marker and may be payload-free.

## RV Lite Step 3 Extended
Require the Core markers plus, in exact order:

`[[ECHO:RVL:DEEPEN:MAIN_ASPECT]]`
`[[ECHO:RVL:DEEPEN:MAIN_ACTIVITY]]`
`[[ECHO:RVL:DEEPEN:CENTER]]`
`[[ECHO:RVL:DEEPEN:SURROUNDINGS]]`
`[[ECHO:RVL:DEEPEN:MAP]]`

All Deepening blocks must contain payload. `STEP3:EXHAUSTED` may be payload-free.

## RV Lite Step 4
One or more numbered sketches:

`[[ECHO:RVL:FUNCTIONAL_SKETCH:N]]`

N must be contiguous and ordered from 1. Every sketch must contain payload.

## Telepathy

### T1
For each N=1..3, exact order:

`[[ECHO:TEL:T1:TOUCH:N]]`
`[[ECHO:TEL:ECHO_DOT]]`
`[[ECHO:TEL:CONTACT_CATEGORY]]`
`[[ECHO:TEL:PRIMITIVE_DESCRIPTOR]]`
`[[ECHO:TEL:ADVANCED_DESCRIPTOR]]`
`[[ECHO:TEL:FORMING]]`

The touch marker is an anchor; all five fields require payload.

### T2
Exact order, all with payload:

`[[ECHO:TEL:T2:RAPID_CONTACT]]`
`[[ECHO:TEL:T2:VECTOR_ORBIT]]`
`[[ECHO:TEL:T2:FUNCTIONAL_SKETCH]]`

### T3–T6
Exactly one RAW marker for the current phase and a non-empty RAW payload, e.g.:

`[[ECHO:TEL:T3:RAW]]`

### T7
Exact Q1..Q6 order. Every question block must contain payload:

`[[ECHO:TEL:T7:Q1]]` ... `[[ECHO:TEL:T7:Q6]]`

### T8
Exact order and non-empty payload:

`[[ECHO:TEL:T8A]]`
`[[ECHO:TEL:T8B]]`

### T9
For every runtime tasking question N, exact ordered marker and non-empty RAW payload:

`[[ECHO:TEL:T9:QN:RAW]]`

### T10
T10 contains exactly 3–5 sourced sentences. Every sentence must be fully parsed and end with one or more references, e.g.:

`A short summary sentence. [SRC:T2,T4]`

There may be no additional unsourced sentence, heading or tail text. Every referenced step must exist and its stored blind-source text must be non-empty.

A semantic support verifier receives only the sentence and its cited blind-source text. `UNSUPPORTED` or `UNCERTAIN` blocks completion or requires explicit review. It never receives target feedback before Reveal.
