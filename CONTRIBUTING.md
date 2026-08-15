# Contributing

Thanks for your interest in this project.

## Licence

This project is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).

By contributing, you agree that your contributions will be licensed under the
same terms. You retain the copyright in your contributions.

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

New source files should carry an SPDX identifier as their first line (after any
shebang):

```
// SPDX-License-Identifier: Apache-2.0
```

Use the comment syntax appropriate to the file type.
