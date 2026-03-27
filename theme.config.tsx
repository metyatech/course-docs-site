import React from 'react';
import { createCourseThemeConfig } from '@metyatech/course-docs-platform/nextra';
import AdminModeFooterToggle from './src/components/admin-mode-footer-toggle';
import {
  getSiteDocsRepositoryBase,
  getSiteLogoText,
  getSiteProjectLink,
} from './src/lib/site-config';

export default createCourseThemeConfig({
  logo: <span>{getSiteLogoText()}</span>,
  projectLink: getSiteProjectLink(),
  docsRepositoryBase: getSiteDocsRepositoryBase(),
  footerRight: <AdminModeFooterToggle />,
});
