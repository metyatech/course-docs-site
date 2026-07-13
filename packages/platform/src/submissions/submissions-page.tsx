import SubmissionsClient from './submissions-client.js';
import { getStudentWorksData } from './work-data.js';

export default async function SubmissionsPage() {
  const studentWorks = await getStudentWorksData();
  return <SubmissionsClient studentWorks={studentWorks} />;
}
