import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { createCourseDownloadUrl } from './create-course-download-url.js';

export type DownloadLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'download' | 'href'
> & {
  file: string;
  filename: string;
  children?: ReactNode;
};

export default function DownloadLink({
  file,
  filename,
  children,
  ...anchorProps
}: DownloadLinkProps) {
  return (
    <a href={createCourseDownloadUrl(file, filename)} download={filename} {...anchorProps}>
      {children ?? filename}
    </a>
  );
}
