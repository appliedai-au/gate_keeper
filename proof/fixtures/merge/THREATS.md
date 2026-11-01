# Threat model (adversarial tests)
- T1: Prototype pollution. User JSON is attacker-controlled. Keys "__proto__", "constructor" and "prototype" must be ignored at every depth, so that no merge can add properties to Object.prototype or to any shared prototype, and the result never gains an inherited property from user input.
- T2: Only the user's own enumerable keys are read; inherited properties of the source are ignored.
