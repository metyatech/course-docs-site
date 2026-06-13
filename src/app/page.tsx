import { redirect } from "next/navigation";
import { getDefaultContentPath } from "../lib/default-content-path";

export default function HomePage() {
  redirect(getDefaultContentPath());
}
