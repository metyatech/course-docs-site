# Security Policy

## Supported Versions

Currently only the latest version of this project is supported.

## Reporting a Vulnerability

Please report any security vulnerabilities by opening a GitHub Issue.
We will address them as soon as possible.

## Known accepted advisories (upstream-blocked)

Known moderate advisories are tracked here because upstream-only fixes remain
visible even when they are not actionable without a breaking upgrade.

- `postcss <8.5.10`: reaches this project solely through Next.js.
  `next@15.5.18` is the current Next 15 security backport, but it still
  bundles `postcss@8.4.31`. The npm audit autofix suggests downgrading
  `next` to `9.3.3`, which is a breaking regression and is not accepted.
  Revisit this entry when a stable Next.js release bundles
  `postcss >=8.5.10`.

Previously accepted Nextra transitive advisories for `mermaid`,
`dompurify`, and `@xmldom/xmldom` are resolved locally through npm
overrides that stay within the upstream dependency ranges. `mathjax-full`
remains deprecated upstream, but it no longer appears in `npm audit` after
the `@xmldom/xmldom` override update.

This list is reviewed whenever a new Dependabot alert opens or a listed
upstream package publishes a new release.
