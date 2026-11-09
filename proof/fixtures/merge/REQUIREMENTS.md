# Requirements (acceptance tests)
- R1: Nested objects merge key by key; keys only in the defaults are kept.
- R2: Arrays and other non-object values from the user replace the default value outright (arrays are not merged element by element).
- R3: An explicit null from the user sets the value to null.
