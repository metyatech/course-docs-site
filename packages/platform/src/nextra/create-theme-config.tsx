import React from 'react';
import type { ReactNode } from 'react';
import { Footer, Navbar } from 'nextra-theme-docs';

type CreateCourseThemeConfigOptions = {
  logo: ReactNode;
  projectLink: string;
  docsRepositoryBase: string;
  footerRight?: ReactNode;
};

export function createCourseThemeConfig({
  logo,
  projectLink,
  docsRepositoryBase,
  footerRight,
}: CreateCourseThemeConfigOptions) {
  return {
    navbar: <Navbar logo={logo} projectLink={projectLink} />,
    footer: (
      <Footer>
        <div className="course-footer-row">
          <p>&copy; {new Date().getFullYear()} さいたまIT・WEB専門学校</p>
          {footerRight ? <div>{footerRight}</div> : null}
        </div>
      </Footer>
    ),
    docsRepositoryBase,
    editLink: null,
    feedback: {
      content: null,
    },
    navigation: {
      prev: true,
      next: true,
    },
    sidebar: {
      defaultMenuCollapseLevel: 1,
      autoCollapse: true,
    },
  };
}
