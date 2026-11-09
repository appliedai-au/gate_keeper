# Requirements (acceptance tests)
- R1: Output follows RFC 4180: records end with CRLF ("\r\n"), including the last record.
- R2: A field containing a comma, a double quote, CR or LF is wrapped in double quotes, and embedded double quotes are doubled ("" inside the quotes).
- R3: null and undefined become empty fields. Numbers and booleans are written as their plain text ("-12.5", "true").
