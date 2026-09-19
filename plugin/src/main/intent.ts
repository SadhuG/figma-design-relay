/**
 * Layout intent, prototyping and annotations — the parts of a node that say
 * what it is *for*, not what it currently measures.
 *
 * Every helper returns `undefined` when the node carries nothing worth saying,
 * so an unremarkable rectangle serializes exactly as it did before phase 2.
 */

export interface LayoutIntent {
  sizingHorizontal?: string;
  sizingVertical?: string;
  grow?: number;
  align?: string;
  positioning?: string;
  reverseZIndex?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReactionSummary {
  trigger?: string;
  actions: Array<{ type: string; destinationId?: string; navigation?: string }>;
}

export interface AnnotationSummary {
  label?: string;
  properties?: string[];
}

export interface ExportSummary {
  format?: string;
  suffix?: string;
  constraint?: { type: string; value?: number };
}

type Raw = Record<string, unknown>;

const LAYOUT_DEFAULTS = {
  layoutSizing: "FIXED",
  layoutGrow: 0,
  layoutAlign: "INHERIT",
  layoutPositioning: "AUTO",
} as const;

const MEASURES = ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const;

/**
 * Extracts hug/fill/grow intent and the min-max constraints.
 * @param node - The raw scene node.
 * @returns The intent, or undefined when the node is at every default.
 */
export const serializeLayoutIntent = (node: Raw): LayoutIntent | undefined => {
  const intent: LayoutIntent = {};

  if (
    typeof node.layoutSizingHorizontal === "string" &&
    node.layoutSizingHorizontal !== LAYOUT_DEFAULTS.layoutSizing
  ) {
    intent.sizingHorizontal = node.layoutSizingHorizontal;
  }
  if (
    typeof node.layoutSizingVertical === "string" &&
    node.layoutSizingVertical !== LAYOUT_DEFAULTS.layoutSizing
  ) {
    intent.sizingVertical = node.layoutSizingVertical;
  }
  if (typeof node.layoutGrow === "number" && node.layoutGrow !== LAYOUT_DEFAULTS.layoutGrow) {
    intent.grow = node.layoutGrow;
  }
  if (typeof node.layoutAlign === "string" && node.layoutAlign !== LAYOUT_DEFAULTS.layoutAlign) {
    intent.align = node.layoutAlign;
  }
  if (
    typeof node.layoutPositioning === "string" &&
    node.layoutPositioning !== LAYOUT_DEFAULTS.layoutPositioning
  ) {
    intent.positioning = node.layoutPositioning;
  }
  if (node.itemReverseZIndex === true) intent.reverseZIndex = true;

  for (const key of MEASURES) {
    const value = node[key];
    if (typeof value === "number") intent[key] = value;
  }

  return Object.keys(intent).length > 0 ? intent : undefined;
};

/**
 * Summarises prototyping reactions down to trigger and destination.
 * @param node - The raw scene node.
 * @returns One summary per reaction, or undefined when there are none.
 */
export const serializeReactions = (node: Raw): ReactionSummary[] | undefined => {
  const reactions = node.reactions;
  if (!Array.isArray(reactions) || reactions.length === 0) return undefined;

  return reactions.map((entry) => {
    const reaction = entry as { trigger?: { type?: string }; actions?: unknown[] };
    const actions = Array.isArray(reaction.actions) ? reaction.actions : [];
    const summary: ReactionSummary = {
      actions: actions.map((raw) => {
        const action = raw as { type?: string; destinationId?: string; navigation?: string };
        const out: ReactionSummary["actions"][number] = { type: action.type ?? "UNKNOWN" };
        if (action.destinationId) out.destinationId = action.destinationId;
        if (action.navigation) out.navigation = action.navigation;
        return out;
      }),
    };
    if (reaction.trigger?.type) summary.trigger = reaction.trigger.type;
    return summary;
  });
};

/**
 * Keeps a designer's Dev Mode notes and the property types they pinned.
 * @param node - The raw scene node.
 * @returns One summary per annotation, or undefined when there are none.
 */
export const serializeAnnotations = (node: Raw): AnnotationSummary[] | undefined => {
  const annotations = node.annotations;
  if (!Array.isArray(annotations) || annotations.length === 0) return undefined;

  return annotations.map((entry) => {
    const annotation = entry as { label?: string; properties?: Array<{ type?: string }> };
    const summary: AnnotationSummary = {};
    if (annotation.label) summary.label = annotation.label;
    const properties = Array.isArray(annotation.properties)
      ? annotation.properties
          .map((property) => property.type)
          .filter((type): type is string => typeof type === "string")
      : [];
    if (properties.length > 0) summary.properties = properties;
    return summary;
  });
};

/**
 * Reports how the designer intends this node to be exported.
 * @param node - The raw scene node.
 * @returns One summary per export setting, or undefined when there are none.
 */
export const serializeExportSettings = (node: Raw): ExportSummary[] | undefined => {
  const settings = node.exportSettings;
  if (!Array.isArray(settings) || settings.length === 0) return undefined;

  return settings.map((entry) => {
    const setting = entry as {
      format?: string;
      suffix?: string;
      constraint?: { type?: string; value?: number };
    };
    const summary: ExportSummary = {};
    if (setting.format) summary.format = setting.format;
    if (setting.suffix) summary.suffix = setting.suffix;
    if (setting.constraint?.type) {
      summary.constraint = { type: setting.constraint.type, value: setting.constraint.value };
    }
    return summary;
  });
};

/**
 * Emits render bounds only when effects or overflow push them past the
 * bounding box — otherwise the two boxes are identical and one is noise.
 * @param node - The raw scene node.
 * @returns The render bounds, or undefined when they match the bounding box.
 */
export const serializeRenderBounds = (node: Raw): Box | undefined => {
  const render = node.absoluteRenderBounds as Box | null | undefined;
  if (!render) return undefined;
  const box = node.absoluteBoundingBox as Box | null | undefined;
  if (
    box &&
    box.x === render.x &&
    box.y === render.y &&
    box.width === render.width &&
    box.height === render.height
  ) {
    return undefined;
  }
  return { x: render.x, y: render.y, width: render.width, height: render.height };
};
