// The platform home-page hard-codes /docs/intro which does not match this
// site's content structure. Redirect to the actual first chapter instead.
// TODO: add createHomePage(path) factory to course-docs-platform so this
//       can be expressed as:
//         export { createHomePage('/docs/01-overview') as default }
import { redirect } from 'next/navigation';

export default function HomePage() {
  redirect('/docs/01-overview');
}
