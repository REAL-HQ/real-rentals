/**
 * The only declaration of the renewal-candidates switch. It is a hard false.
 * Other files import this module. They do not copy the constant.
 * No environment variable can turn it on.
 */
export const RENEWAL_CANDIDATES_ENABLED: boolean = false as boolean;
