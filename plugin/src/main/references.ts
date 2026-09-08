/**
 * Resolves the design-system references a node points at — bound variables and
 * named styles — into shapes an agent can act on.
 *
 * Under `documentAccess: "dynamic-page"` the Plugin API only exposes async
 * lookups, so every resolver takes its lookup as a parameter. That also keeps
 * this module free of the `figma` global, so it unit-tests under Bun.
 */

export interface VariableRef {
  property: string;
  variableId: string;
  variableName?: string;
  collectionName?: string;
}

export interface StyleRef {
  id: string;
  name?: string;
}

export type VariableLookup = (
  id: string
) => Promise<{ name: string; variableCollectionId: string } | null>;

export type CollectionLookup = (id: string) => Promise<{ name: string } | null>;

export type StyleLookup = (id: string) => Promise<{ name: string } | null>;

interface VariableAlias {
  type: "VARIABLE_ALIAS";
  id: string;
}

const isAlias = (value: unknown): value is VariableAlias =>
  typeof value === "object" &&
  value !== null &&
  (value as VariableAlias).type === "VARIABLE_ALIAS" &&
  typeof (value as VariableAlias).id === "string";

/**
 * Flattens `{ fills: [alias, alias], cornerRadius: alias }` into one list,
 * naming array entries by position so `fills[0]` is addressable.
 */
const flattenAliases = (
  boundVariables: Record<string, unknown>
): Array<{ property: string; id: string }> => {
  const out: Array<{ property: string; id: string }> = [];
  for (const [field, value] of Object.entries(boundVariables)) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (isAlias(entry)) out.push({ property: `${field}[${index}]`, id: entry.id });
      });
    } else if (isAlias(value)) {
      out.push({ property: field, id: value.id });
    }
  }
  return out;
};

/**
 * Resolves a node's `boundVariables` map into named references.
 * @param boundVariables - The raw map off the node, or undefined.
 * @param lookupVariable - Async variable lookup by id.
 * @param lookupCollection - Async collection lookup by id.
 * @returns One entry per binding, or undefined when nothing is bound.
 */
export const resolveBoundVariables = async (
  boundVariables: Record<string, unknown> | undefined,
  lookupVariable: VariableLookup,
  lookupCollection: CollectionLookup
): Promise<VariableRef[] | undefined> => {
  if (!boundVariables) return undefined;

  const aliases = flattenAliases(boundVariables);
  if (aliases.length === 0) return undefined;

  return Promise.all(
    aliases.map(async ({ property, id }): Promise<VariableRef> => {
      const variable = await lookupVariable(id);
      if (!variable) return { property, variableId: id };
      const collection = await lookupCollection(variable.variableCollectionId);
      const ref: VariableRef = { property, variableId: id, variableName: variable.name };
      if (collection) ref.collectionName = collection.name;
      return ref;
    })
  );
};

/**
 * Resolves one `*StyleId` property to its style name.
 * @param styleId - The raw property value; `figma.mixed` is a symbol.
 * @param lookupStyle - Async style lookup by id.
 * @returns The named reference, the string "mixed", or undefined when unset.
 */
export const resolveStyleRef = async (
  styleId: unknown,
  lookupStyle: StyleLookup
): Promise<StyleRef | "mixed" | undefined> => {
  if (typeof styleId === "symbol") return "mixed";
  if (typeof styleId !== "string" || styleId === "") return undefined;
  const style = await lookupStyle(styleId);
  return style ? { id: styleId, name: style.name } : { id: styleId };
};
