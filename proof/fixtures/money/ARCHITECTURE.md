# Architecture (integration tests)
- invoiceTotalCents composes parseAmountCents per line and multiplies by qty; totals must equal the sum of correctly parsed lines.
