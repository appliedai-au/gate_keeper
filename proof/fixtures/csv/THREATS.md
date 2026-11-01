# Threat model (adversarial tests)
- T1: Formula injection. A text field whose first character is =, +, -, @, TAB or CR must not be interpreted as a formula: prefix it with a single quote (') before any quoting, so "=1+1" is written as '=1+1 and "=SUM(A1,A2)" as "'=SUM(A1,A2)".
- T2: The prefix applies to text only. Values of type number are data, so a negative number such as -5 is written as -5 with no prefix.
