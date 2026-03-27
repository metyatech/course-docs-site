# Admonition authoring for Course Docs Site

Course Docs Site supports the following admonition types in MDX container directives:

- `tip`
- `note`
- `warning`
- `caution`
- `important`

Use them with the standard directive syntax:

```mdx
:::tip
補足や学習のコツを書きます。
:::

:::note[確認ポイント]
読み飛ばしてほしくない補足を書きます。
:::
```

## Titles

Titles are optional.

- Without a title: the site renders a normal Nextra callout.
- With a title: add a directive label such as `:::note[確認ポイント]`.

## Validation

Unsupported admonition types fail the MDX build with an explicit error.

Examples:

- `:::info` → use `:::note`
- `:::danger` → use `:::caution`
- `:::default` → use `:::tip`
- `:::error` → use `:::caution`

This keeps authoring vocabulary aligned with GitHub/Nextra-style admonition names while still rendering through the shared Course Docs Site components.
