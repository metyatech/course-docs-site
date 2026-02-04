import React from 'react';
import { createCourseThemeConfig } from '@metyatech/course-docs-platform/nextra';
import AdminFooterToggle from '@metyatech/course-docs-platform/submissions/admin-footer-toggle';
import { siteConfig } from './site.config';

export default createCourseThemeConfig({
  logo: <span>{siteConfig.logoText}</span>,
  projectLink: siteConfig.projectLink,
  docsRepositoryBase: siteConfig.docsRepositoryBase,
  footerRight: <AdminFooterToggle />,
});

