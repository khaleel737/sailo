/*
 * The unauthenticated licence surface — spec 48. Its own entry point rather
 * than a corner of `@sailo/api/rest`, because the whole point of it is that it
 * does *not* take an API key, and an export sitting beside the ones that do is
 * an invitation to give it one.
 */
export {
  handleLicenseActivate,
  handleLicenseDeactivate,
  handleLicenseValidate,
} from "./handlers";
