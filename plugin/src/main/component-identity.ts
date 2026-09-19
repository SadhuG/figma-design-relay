/**
 * Component and instance identity.
 *
 * `componentPropertyDefinitions` is readable only from the node that owns the
 * definitions. Reading it from a variant `COMPONENT` — one whose parent is a
 * `COMPONENT_SET` — throws, and optional chaining does not make the getter
 * safe. So narrow the owner first, always.
 */

export interface NodeLike {
  id: string;
  type: string;
  name?: string;
  key?: string;
  parent?: NodeLike | null;
  componentPropertyDefinitions?: Record<string, unknown>;
}

export interface ComponentRef {
  id: string;
  key?: string;
  name?: string;
}

export interface ComponentIdentity {
  key?: string;
  propertyDefinitions?: Record<string, unknown>;
  /** Set only when the definitions came from a parent set rather than the node. */
  propertyOwnerId?: string;
}

export interface InstanceLike {
  getMainComponentAsync: () => Promise<ComponentRef | null>;
  componentProperties?: Record<string, { type: string; value: unknown }>;
}

export interface InstanceIdentity {
  mainComponent?: ComponentRef;
  componentProperties?: Record<string, { type: string; value: unknown }>;
}

/**
 * Returns the node that owns `componentPropertyDefinitions`.
 * @param node - Any scene node.
 * @returns The owning node, or null when the node is not a component at all.
 */
export const componentPropertyOwner = (node: NodeLike): NodeLike | null => {
  if (node.type === "COMPONENT_SET") return node;
  if (node.type !== "COMPONENT") return null;
  return node.parent && node.parent.type === "COMPONENT_SET" ? node.parent : node;
};

/**
 * Serializes a `COMPONENT` or `COMPONENT_SET`'s published identity.
 * @param node - The component or component set.
 * @returns Its key and property definitions, or undefined when it has neither.
 */
export const serializeComponentIdentity = (node: NodeLike): ComponentIdentity | undefined => {
  const owner = componentPropertyOwner(node);
  if (!owner) return undefined;

  const identity: ComponentIdentity = {};
  if (node.key) identity.key = node.key;

  const definitions = owner.componentPropertyDefinitions;
  if (definitions && Object.keys(definitions).length > 0) {
    identity.propertyDefinitions = definitions;
    if (owner.id !== node.id) identity.propertyOwnerId = owner.id;
  }

  return Object.keys(identity).length > 0 ? identity : undefined;
};

/**
 * Serializes an `INSTANCE`'s link back to its main component.
 * @param instance - The instance node.
 * @returns Its main component and set properties, or undefined when it has neither.
 */
export const serializeInstanceIdentity = async (
  instance: InstanceLike
): Promise<InstanceIdentity | undefined> => {
  const main = await instance.getMainComponentAsync();
  const properties = instance.componentProperties;
  const hasProperties = properties !== undefined && Object.keys(properties).length > 0;
  if (!main && !hasProperties) return undefined;

  const identity: InstanceIdentity = {};
  if (main) identity.mainComponent = { id: main.id, key: main.key, name: main.name };
  if (hasProperties) identity.componentProperties = properties;
  return identity;
};
