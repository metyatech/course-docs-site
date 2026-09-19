import {
  getAdminSessionCookieName,
  getAdminSessionSecret as getSessionSecret,
  isAdminSessionSecretValid,
  isAdminSessionValid as isAdminSessionValidImpl,
} from "./admin/session";
import { getSiteAdminCommentModeration } from "./site-config";

/** Returns the human-entered admin login code (`ADMIN_MODE_TOKEN`). */
export const getAdminModeToken = (): string => (process.env.ADMIN_MODE_TOKEN ?? "").trim();

/** Returns the signed admin-session cookie name. */
export const getAdminModeCookieName = () => getAdminSessionCookieName();

/** Returns the admin-session HMAC secret (`ADMIN_SESSION_SECRET`). */
export const getAdminSessionSecret = (): string => getSessionSecret();

/**
 * The login token and HMAC secret must be distinct so knowledge of the
 * human-entered code cannot forge an admin session cookie.
 */
export const areAdminSecretsDistinct = (): boolean => {
  const token = getAdminModeToken();
  const secret = getAdminSessionSecret();
  return token !== "" && secret !== "" && token !== secret;
};

/** True when the active course site enables comment moderation. */
export const hasAdminCommentModeration = (): boolean => getSiteAdminCommentModeration();

/** True when the active course site has an admin capability. */
export const hasAnyAdminCapability = (): boolean => hasAdminCommentModeration();

/** True when the signed admin session can serve comment moderation. */
export const isAdminModeConfigured = (): boolean =>
  hasAnyAdminCapability() &&
  getAdminModeToken() !== "" &&
  isAdminSessionSecretValid(getAdminSessionSecret()) &&
  areAdminSecretsDistinct();

export const isAdminSessionValid = (cookieValue: string | null | undefined) =>
  isAdminSessionValidImpl(cookieValue ?? undefined, getAdminSessionSecret());
