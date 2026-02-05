import themeConfig from '../../../theme.config';
import { createDocsLayout } from '@metyatech/course-docs-platform/next-app/create-docs-layout';

export default createDocsLayout(themeConfig as Record<string, unknown>);
