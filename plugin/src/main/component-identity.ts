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
  description?: string;
  parent?: NodeLike | null;
  componentPropertyDefinitions?: Record<string, unknown>;
}

export interface ComponentRef {
  id: string;
  key?: string;
  name?: string;
  /**
   * The component set's name when the main component is a variant. A variant's
   * own `name` is its property string ("Size=M, Type=Primary"); the set's name
   * ("Button") is the one an agent needs.
   */
  setName?: string;
  /** The component set's id when the main component is a variant. */
  setId?: string;
}

export interface ComponentIdentity {
  key?: string;
  propertyDefinitions?: Record<string, unknown>;
  /** Set only when the definitions came from a parent set rather than the node. */
  propertyOwnerId?: string;
}

export interface MainComponentLike {
  id: string;
  key?: string;
  name?: string;
  parent?: { id?: string; type: string; name?: string } | null;
}

export interface InstanceLike {
  getMainComponentAsync: () => Promise<MainComponentLike | null>;
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
  if (main) {
    identity.mainComponent = { id: main.id, key: main.key, name: main.name };
    if (main.parent?.type === "COMPONENT_SET" && typeof main.parent.name === "string") {
      if (main.parent.id) identity.mainComponent.setId = main.parent.id;
      identity.mainComponent.setName = main.parent.name;
    }
  }
  if (hasProperties) identity.componentProperties = properties;
  return identity;
};

export interface CodeConnectContext {
  /** The node a mapping should target: the set for a variant, else the component. */
  id: string;
  name?: string;
  type: string;
  key?: string;
  description?: string;
  propertyDefinitions: Record<string, unknown>;
  variantAxes: Array<{ name: string; options: string[] }>;
  /** The variant that was passed in, when it was not the mapping target itself. */
  selectedVariant?: { id: string; name?: string };
}

/**
 * Describes a component for authoring a Code Connect mapping.
 * @param node - A `COMPONENT` or `COMPONENT_SET`.
 * @param mainComponentId - For an instance, its main component's id, so the
 * refusal can say which node to pass instead.
 * @returns The mapping target's identity, properties and variant axes.
 * @throws When the node is not a component.
 */
export const describeForCodeConnect = (
  node: NodeLike,
  mainComponentId?: string
): CodeConnectContext => {
  const owner = componentPropertyOwner(node);
  if (!owner) {
    if (node.type === "INSTANCE") {
      throw new Error(
        `Node ${node.id} is an INSTANCE. Code Connect maps components — pass its main component` +
          (mainComponentId ? ` (${mainComponentId})` : "") +
          ` instead.`
      );
    }
    throw new Error(
      `Node ${node.id} is a ${node.type}, not a COMPONENT or COMPONENT_SET. ` +
        `Code Connect maps components; pass the main component.`
    );
  }

  const definitions = owner.componentPropertyDefinitions ?? {};
  const variantAxes = Object.entries(definitions)
    .filter(([, definition]) => (definition as { type?: string }).type === "VARIANT")
    .map(([name, definition]) => ({
      name,
      options: (definition as { variantOptions?: string[] }).variantOptions ?? [],
    }));

  const context: CodeConnectContext = {
    id: owner.id,
    name: owner.name,
    type: owner.type,
    key: owner.key,
    propertyDefinitions: definitions,
    variantAxes,
  };
  if (owner.description) context.description = owner.description;
  if (owner.id !== node.id) context.selectedVariant = { id: node.id, name: node.name };
  return context;
};
