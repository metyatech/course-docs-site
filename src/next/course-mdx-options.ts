import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkAdmonitionsToMdx from '../mdx/remark-admonitions-to-mdx.js';
import remarkSectionHeadings from '../mdx/remark-section-headings.js';
import remarkTutorialLint from '../mdx/tutorial/remark-tutorial-lint.js';
import remarkInjectTutorialShotLegend from '../mdx/remark-inject-tutorial-shot-legend.js';

export const courseRemarkPlugins = [
  remarkGfm,
  remarkDirective,
  remarkAdmonitionsToMdx,
  remarkInjectTutorialShotLegend,
  remarkTutorialLint,
  remarkSectionHeadings,
] as const;

export const courseMdxOptions = {
  remarkPlugins: courseRemarkPlugins,
};
