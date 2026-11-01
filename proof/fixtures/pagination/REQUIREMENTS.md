# Requirements (acceptance tests)
- R1: Pages are 1-based: page 1 of [1,2,3,4,5] with size 2 is [1,2].
- R2: A partial last page is a page: [1,2,3,4,5] with size 2 has 3 pages and page 3 is [5].
- R3: An empty list has 0 pages; page 1 of an empty list returns no items.
