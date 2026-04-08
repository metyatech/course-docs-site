import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkAdmonitionsToMdx from '../mdx/remark-admonitions-to-mdx.js';
import remarkQuestionSpecToExercise from '../mdx/remark-question-spec-to-exercise.js';
import remarkSectionHeadings from '../mdx/remark-section-headings.js';

export const courseRemarkPlugins = [
  remarkGfm,
  remarkDirective,
  remarkAdmonitionsToMdx,
  remarkQuestionSpecToExercise,
  remarkSectionHeadings,
] as const;

export const courseMdxOptions = {
  remarkPlugins: courseRemarkPlugins,
};
