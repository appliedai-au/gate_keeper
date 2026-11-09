# Requirements (acceptance tests)
- R1: Ampersands are escaped: escapeHtml("a & b") is "a &amp; b".
- R2: Text that already looks like an entity is preserved literally: escapeHtml("&lt;") is "&amp;lt;".
- R3: link("https://x.test/?a=1&b=2", "Q&A") is '<a href="https://x.test/?a=1&amp;b=2">Q&amp;A</a>'.
- R4: Relative and mailto links are allowed: link("/docs?x=1", "d") and link("mailto:a@b.test", "m") render.
