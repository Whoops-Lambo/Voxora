// The Play build consumes existing digital entitlements. It has no Play Billing
// integration or approved external digital-payment program configured yet.
export const isPlayBuild=(userAgent=globalThis.navigator?.userAgent||'')=>/\bVoxoraPlay\/\d+(?:\.\d+){0,2}\b/.test(String(userAgent));
