import React from 'react';
import { createCourseThemeConfig } from '@metyatech/course-docs-platform/nextra';
import AdminFooterToggle from '@metyatech/course-docs-platform/submissions/admin-footer-toggle';
import { siteConfig } from './site.config';

const repoUrl = `https://github.com/${siteConfig.githubRepo}`;

export default createCourseThemeConfig({
  logo: <span>{siteConfig.title}</span>,
  projectLink: repoUrl,
  docsRepositoryBase: `${repoUrl}/tree/main`,
  footerRight: <AdminFooterToggle />,
});

