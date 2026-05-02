# Security Policy

## Supported Versions

Currently only the latest version of this project is supported.

## Reporting a Vulnerability

Please report any security vulnerabilities by opening a GitHub Issue.
We will address them as soon as possible.

## Known accepted advisories (upstream-blocked)

The following Dependabot advisories remain open because the fix is
gated on an upstream release we cannot influence locally. Each entry
identifies the transitive dependency, the upstream package that pins
it, and the reason the advisory cannot be resolved by a direct or
override-based bump in this repository.

- `dompurify <=3.3.3`, `@xmldom/xmldom 0.9.0-0.9.9`, `mathjax-full`,
  `speech-rule-engine`, `mermaid`, `better-react-mathjax`,
  `@theguild/remark-mermaid`: pulled in by `nextra` 4.x. `nextra@4.6.1`
  (latest) still pins the vulnerable transitive ranges. Awaiting an
  upstream nextra release that bumps mermaid / mathjax-full /
  speech-rule-engine.
- `next` (advisory range covers `9.3.4-canary.0 - 16.3.0-canary.5`):
  no fixed stable release exists yet; only `16.3.0` canary builds
  carry the fix. Awaiting `next@16.3.0` stable.
- `postcss <8.5.10`: reaches us solely as a transitive of `next`.
  Resolves once `next` upgrades its bundled `postcss`.
- `uuid <14.0.0` (via `mermaid`): `uuid@14` is a major release that
  current `mermaid` versions are not compatible with. Awaiting
  upstream `mermaid` upgrade.

We do not apply `npm audit fix --force` because every proposed fix
downgrades `nextra` to `4.2.17` or `next` to `9.3.3`, both of which
are major regressions with no security benefit. We also do not pin
overrides for these transitives until the upstream fix lands, to
avoid masking later upstream resolutions.

This list is reviewed whenever a new Dependabot alert opens or a
listed upstream package publishes a new release.
