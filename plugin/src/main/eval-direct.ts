/**
 * The one place in the codebase that calls `eval`.
 *
 * This MUST stay a *direct* eval (`eval(source)`), never an indirect one
 * (`(0, eval)(source)`). Figma's plugin sandbox is a Realm that wraps plugin
 * code in `with (scopeProxy) { ... }`; a direct eval inherits that scope chain,
 * which is what makes the `figma` global resolve inside evaluated source.
 * An indirect eval runs in the realm's global scope, where it does not.
 *
 * Bundlers warn that direct eval defeats scope minification. That warning is
 * expected and is why this call lives alone in a module with no imports.
 */
export const evalDirect = (source: string): unknown => eval(source);
