import type { ReactNode } from 'react';
import type { LearningBundleV2, LearningContentNodeV2 } from '../schema.js';

const previewCsp =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export const buildRenderedHtmlCssDocument = (html: string, css: string): string =>
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${previewCsp}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.replace(/<\/style/giu, '<\\/style')}</style></head><body>${html}</body></html>`;

interface LearningContentRendererProps {
  readonly bundle: LearningBundleV2;
  readonly nodes: readonly LearningContentNodeV2[];
}

export function LearningContentRenderer({ bundle, nodes }: LearningContentRendererProps) {
  return (
    <div className="learning-v2__content">
      {nodes.map((node, index): ReactNode => {
        if (node.kind === 'text') return <p key={`${node.kind}-${index}`}>{node.text}</p>;
        if (node.kind === 'code')
          return (
            <pre key={`${node.kind}-${index}`} className="learning-v2__code">
              <code data-language={node.language}>{node.code}</code>
            </pre>
          );
        const resource = bundle.resourceManifest.find(({ id }) => id === node.resourceId);
        if (!resource) return null;
        if (resource.kind === 'static-text') return <p key={resource.id}>{resource.payload}</p>;
        return (
          <iframe
            key={resource.id}
            className="learning-v2__preview"
            title="表示結果"
            sandbox=""
            srcDoc={buildRenderedHtmlCssDocument(resource.payload.html, resource.payload.css)}
          />
        );
      })}
    </div>
  );
}
