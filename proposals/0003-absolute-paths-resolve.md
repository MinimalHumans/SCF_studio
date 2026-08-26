<!-- SPDX-License-Identifier: CC-BY-4.0 -->

# 0003 — An absolute path should resolve to bytes

| | |
|---|---|
| **Status** | draft |
| **Author** | Raised by the maintainers, from a studio use case |
| **Opened** | 2026-08-26 |
| **Affects** | Spec §8.2 and §8.3, `FileLocator` in `scf-core/src/assets.ts`, `scf-app/src/files/assetLocator.ts` |

## The problem

**§8.3 defines `out-of-root` as "resolvable but non-portable", and the
reference implementation never resolves it.**

`resolveIdentifier` returns early for an absolute identifier and never
calls the locator:

```ts
if (identifier.absolute) {
  return { ...base, state: "out-of-root",
           detail: "an absolute path resolves on this machine and " +
                   "nowhere else — it will not travel with the project" };
}
```

No `sizeBytes`, no `mtime`, no preview, no confirmation the file exists
— on any machine, including the one where the path is correct. The
detail string says the path "resolves on this machine", which is exactly
what the code declines to find out.

**The format is not the problem.** §8.2 says absolute paths are
representable, `asset.identifier_absolute` is a **warning**, and the
negative fixture's own description reads *"Representable on purpose
(§8.2), non-portable, and a warning rather than an error."* Every
normative statement here treats an absolute path as legal and merely
non-portable. Only the resolver treats it as unreachable.

**The use case is real and ordinary.** A studio holds corpus footage
across several volumes. Named roots serve that better — see below — but
someone will paste an absolute path, the format says they may, and what
they get is an asset that can never be previewed, sized, or confirmed to
exist.

`..` is a genuinely different case and is not in scope: §8.2 says a path
climbing above its root MUST NOT be resolved, `asset.identifier_escapes_root`
is an **error**, and that should not change.

## The proposal

**Attempt resolution for an absolute identifier, and keep the state.**

1. Widen `FileLocator` so `root: null` means "this is an absolute path"
   rather than being unreachable. It already accepts `string | null`;
   the contract does not say what `null` means and nothing passes it.
2. `resolveIdentifier` calls the locator for an absolute identifier as
   it does for a rooted one, and populates `sizeBytes` and `mtime` from
   whatever comes back.
3. **The state stays `out-of-root` whether or not bytes were found.**
   That is what §8.3 already says the state means, and the
   non-portability warning is carried by `asset.identifier_absolute`
   independently — nothing about the finding changes.
4. An environment that cannot open an absolute path returns `undefined`,
   and the result is exactly what it is today. **A browser genuinely
   cannot do this**, so the reference editor is unaffected, and §8.2
   states it as a MAY rather than a MUST.

§8.3's wording then becomes true: resolvable, and non-portable.

## What it breaks

**Nothing in the repository.** The fixture has no absolute identifiers
outside the negative case, and `asset-absolute.expected.json` asserts a
finding rather than a resolution state.

**One behaviour changes for a consumer that implements it:** an absolute
asset that previously reported no size now reports one. Anything reading
`sizeBytes === null` as "not resolvable" would be reading a null as a
statement, which §12.1.4 says it is not.

**A conformance question worth settling before this lands:** two
implementations, one able to open absolute paths and one not, would
produce different `sizeBytes` for the same file. That is already true of
`unmaterialised` (§8.3, environment-dependent by design) — but it should
be stated, not inherited by accident.

## Alternatives

**Do nothing, and fix §8.3's wording instead.** Change "resolvable but
non-portable" to "not resolved". Honest, one word, and it closes the
contradiction by taking the capability away — which makes an absolute
path strictly worse than the spec currently promises.

**Named roots only.** `@plates` and `@nas` are reserved in §10.2 and the
resolver already passes a root name through, so a studio with material
on three volumes can address all of it portably today. **This is the
better answer for that use case** and this proposal does not compete
with it. It does not cover the person who pastes a path anyway, which
the format explicitly permits.

**Resolve absolute paths and report `resolved`.** Wrong: it discards the
non-portability, and `out-of-root` exists precisely to carry it.

**Make it configurable.** A flag deciding whether absolute paths resolve
is a second way to answer one question, and two consumers would disagree
about the same file for a reason not in the file.

## Unresolved

- **Should the `FileLocator` contract distinguish "cannot open absolute
  paths" from "looked and found nothing"?** It already distinguishes
  `undefined` from `null` for roots, so probably yes, and the same
  distinction should carry.
- Does `unaddressed` apply when an environment declines absolute paths
  altogether? Arguably that is nearer the truth than `out-of-root` — but
  it would lose the non-portability signal, which matters more.
- **Should the editor grow named-root support first?** It returns
  `undefined` for any root that is not `@project`, so the portable
  answer to the multi-drive case is unavailable in the reference
  implementation. That is separate work and probably higher value than
  this proposal.

---

## Resolution

*Left empty until the proposal is accepted, declined or deferred.*
