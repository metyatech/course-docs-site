import ts from "typescript";

const unwrapStaticExpression = (expression) => {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    (typeof ts.isSatisfiesExpression === "function" && ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
};

const staticPropertyName = (name) => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return undefined;
};

const readStaticMetaObject = (sourceFile, expression) => {
  const value = unwrapStaticExpression(expression);
  if (ts.isObjectLiteralExpression(value)) return value;
  if (!ts.isIdentifier(value)) return undefined;

  const declarations = sourceFile.statements.flatMap((statement) =>
    ts.isVariableStatement(statement)
      ? statement.declarationList.declarations.filter(
          (declaration) =>
            ts.isIdentifier(declaration.name) && declaration.name.text === value.text,
        )
      : [],
  );
  if (declarations.length !== 1 || !declarations[0].initializer) return undefined;
  const initializer = unwrapStaticExpression(declarations[0].initializer);
  return ts.isObjectLiteralExpression(initializer) ? initializer : undefined;
};

/** Read only literal page keys and literal display settings from Nextra metadata. */
export const parseNextraMetaOrder = (source) => {
  const sourceFile = ts.createSourceFile(
    "_meta.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) return { supported: false, entries: [] };
  const assignment = sourceFile.statements.find(
    (statement) => ts.isExportAssignment(statement) && !statement.isExportEquals,
  );
  if (!assignment) return { supported: false, entries: [] };
  const object = readStaticMetaObject(sourceFile, assignment.expression);
  if (!object) return { supported: false, entries: [] };

  const entries = [];
  const seen = new Set();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) return { supported: false, entries: [] };
    const key = staticPropertyName(property.name);
    if (key === undefined || seen.has(key)) return { supported: false, entries: [] };
    seen.add(key);
    const item = unwrapStaticExpression(property.initializer);
    let hidden = false;
    if (ts.isStringLiteral(item) || ts.isNoSubstitutionTemplateLiteral(item)) {
      entries.push({ key, hidden });
      continue;
    }
    if (!ts.isObjectLiteralExpression(item)) return { supported: false, entries: [] };
    const itemKeys = new Set();
    for (const itemProperty of item.properties) {
      if (!ts.isPropertyAssignment(itemProperty)) return { supported: false, entries: [] };
      const itemKey = staticPropertyName(itemProperty.name);
      if (itemKey === undefined || itemKeys.has(itemKey)) return { supported: false, entries: [] };
      itemKeys.add(itemKey);
      if (itemKey === "display") {
        const display = unwrapStaticExpression(itemProperty.initializer);
        if (!ts.isStringLiteral(display) && !ts.isNoSubstitutionTemplateLiteral(display))
          return { supported: false, entries: [] };
        hidden = display.text === "hidden";
      }
    }
    entries.push({ key, hidden });
  }
  return { supported: true, entries };
};
