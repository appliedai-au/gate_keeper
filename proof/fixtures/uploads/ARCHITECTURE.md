# Architecture (integration tests)
- readUpload delegates every path decision to resolveUpload and only then touches the filesystem; a rejected path must never reach fs.readFileSync.
