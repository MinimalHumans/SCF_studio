<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# Contributing

Thanks for your interest in this project.

## Where a change goes

Three routes, and picking the right one is most of the work:

| | |
|---|---|
| **A change to the format** | A proposal in [`proposals/`](proposals/). Anything that changes what a conforming implementation must do. |
| **A defect** | An issue. The specification says one thing and the artifacts do another, a rule cannot be implemented as written, a term is used and never defined. You do not need to propose a fix. |
| **Everything else** | A pull request. Editorial fixes, tests, tooling, clarifications that change no requirement. |

[`GOVERNANCE.md`](GOVERNANCE.md) says who decides and what they weigh.
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) applies throughout.
Security issues go privately — [`SECURITY.md`](SECURITY.md), never an issue.

## Licence

Code is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

**Prose is licensed CC BY 4.0**, which is not the same licence. The boundary
runs between written documents and generated data, and is stated in
[`spec/LICENSE`](spec/LICENSE). Generated artifacts carry the licence of the
code that produces them.

By contributing, you agree that your contributions will be licensed under the
licence applying to the files you touched. You retain the copyright in your
contributions.

## Developer Certificate of Origin

All commits must be signed off. Sign-off certifies that you wrote the patch, or
otherwise have the right to submit it under the project's licence. It is a
statement about provenance, not a copyright assignment.

Sign off by adding `-s` to your commit:

```
git commit -s -m "your message"
```

This appends a line to your commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use your real name and a real email address. Commits without a sign-off line
will not be merged.

The full text of the Developer Certificate of Origin 1.1 follows.

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same license (unless I am permitted to submit
    under a different license), as indicated in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Third-party material

Do not commit copyrighted screenplays, scripts, novels, images, audio or other
third-party material, including as test fixtures. Test corpora must be either
original work, public domain, or supplied locally by the developer and excluded
from version control.

Tests that depend on a locally supplied corpus must skip when it is absent, not
fail.

## Source file headers

New source files MUST carry an SPDX identifier as their first line (after any
shebang):

```
// SPDX-License-Identifier: Apache-2.0
```

Use the comment syntax appropriate to the file type. Markdown takes an HTML
comment, and prose carries `CC-BY-4.0` rather than `Apache-2.0`.

CI checks this on every push:

```sh
python3 tools/add_spdx_headers.py --check     # reports what is missing
python3 tools/add_spdx_headers.py --apply     # writes the headers
```

## Before you push

```sh
python3 tools/verify.py            # everything CI runs, one exit code
python3 tools/verify.py --fast     # skips the packaging test and app build
```

Run it rather than assembling the commands by hand. A chain like
`npm test | tail -1 && npm run build` reports the exit code of `tail`,
so a failing step scrolls past as one quiet line — which is how a broken
packaging test once reached `main` with a green local check.

The tool is idempotent, skips generated artifacts that are checksummed, and
runs without git if it has to.
