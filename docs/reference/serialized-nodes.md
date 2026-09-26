# Serialized node shape

Every read tool that walks the scene graph — `get_document`, `get_node`, `get_selection` and
`get_design_context` — returns nodes through one serializer,
[`plugin/src/main/serializer.ts`](../../plugin/src/main/serializer.ts). This page documents the fields
that carry **design-system identity and intent** rather than geometry.

The governing rule, and the part readers get wrong: **every field on this page is omitted when the
node has nothing to say for it.** A plain rectangle with no component, variable, style, annotation
or layout intent serializes to exactly the five keys it always had — `id`, `name`, `type`, `bounds`
and `styles`. Enrichment is not allowed to make `get_document` unusable on a large page, so the
helpers return `undefined` at the source instead of emitting empty objects a consumer would then
have to filter.

## `design`

Present only when the node references the design system in at least one way. If a node is not a
component or instance, has no bound variables and uses no named styles, the whole `design` block is
absent.

| Field                 | Present when                                                         | Omitted when                                     |
| --------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| `mainComponent`       | The node is an `INSTANCE` whose main component resolves              | Not an instance, or the instance is detached     |
| `componentProperties` | An `INSTANCE` has at least one property set                          | Not an instance, or the property map is empty    |
| `key`                 | The node is a `COMPONENT` or `COMPONENT_SET` with a published key    | The node is neither, or has never been published |
| `propertyDefinitions` | The owning component node declares at least one property             | There are no definitions                         |
| `propertyOwnerId`     | The definitions were read from a **parent set**, not the node itself | The node owns its own definitions                |
| `boundVariables`      | At least one property is bound to a variable                         | Nothing is bound                                 |
| `styles`              | At least one of the five `*StyleId` properties is set                | The node uses no named styles                    |

`mainComponent` is `{ id, key, name, setId?, setName?, remote?, description? }` — `setId` and `setName` are the component set's id and name when the main component is a variant, since a variant's own `name` is its property string. `setId` is what a Code Connect mapping to the set is matched by. `remote` is `true` when the component comes from a library rather than this file. `description` is the designer's documentation — the variant's own, else its set's — and is omitted when both are blank; `get_design_context` surfaces it as a `component description:` hint. `componentProperties` maps a property name to
`{ type, value }`, so an instance of `Button/Primary` is recognisable as one.

### `propertyOwnerId` and the variant trap

`componentPropertyDefinitions` is readable **only from the node that owns the definitions**. Reading
the getter off a variant `COMPONENT` — one whose parent is a `COMPONENT_SET` — throws, and optional
chaining does not make it safe. The serializer therefore resolves the owner first: a `COMPONENT_SET`
owns its own definitions, a standalone `COMPONENT` owns its own, and a variant promotes to its
parent set. When the definitions came from a parent rather than the node itself, `propertyOwnerId`
names that parent; otherwise it is omitted.

### `boundVariables`

A list, not a map, so paint-level bindings stay addressable. Each entry is
`{ property, variableId, variableName?, collectionName? }`. Array bindings are indexed by position,
so a fill bound to a colour token reports `property: "fills[0]"`. `variableName` is the token's full
path — `color/brand/primary`, never a hex string — and `collectionName` is the collection it lives
in. When the variable cannot be resolved (it belongs to a library the file cannot reach, say), the
entry keeps `variableId` alone and both names are omitted, so the binding is still visible.

### `styles`

Keyed by role — `fill`, `stroke`, `effect`, `grid`, `text` — mapping to the corresponding
`fillStyleId`, `strokeStyleId`, `effectStyleId`, `gridStyleId` and `textStyleId`. Each value is
`{ id, name? }`, or the string `"mixed"` when the property is `figma.mixed`, matching the convention
the rest of the serializer uses. `name` is omitted when the style id does not resolve; a role is
omitted entirely when its style id is unset.

## `layout`

Hug/fill intent and the sizing constraints. Without these an agent sees only current pixel
measurements and emits fixed sizes where the designer meant "fill container".

| Field                                            | Present when                        | Omitted when                                                      |
| ------------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------- |
| `sizingHorizontal`, `sizingVertical`             | The sizing is `HUG` or `FILL`       | The property is absent or `FIXED`, Figma's default for every node |
| `grow`                                           | `layoutGrow` is not `0`             | At the default `0`                                                |
| `align`                                          | `layoutAlign` is not `"INHERIT"`    | At the default `"INHERIT"`                                        |
| `positioning`                                    | `layoutPositioning` is not `"AUTO"` | At the default `"AUTO"`                                           |
| `reverseZIndex`                                  | `itemReverseZIndex` is `true`       | `false` or absent                                                 |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | The constraint is set to a number   | The constraint is `null`                                          |

The whole `layout` block is omitted when every one of these is at its default — which is the common
case, and the reason a page of plain frames does not grow.

## `reactions`

Prototyping triggers and their destinations, summarised rather than passed through whole. One entry
per reaction: `{ trigger?, actions[] }`, where `trigger` is the trigger type (`"ON_CLICK"`) and each
action is `{ type, destinationId?, navigation? }`. An action with no readable type is reported as
`"UNKNOWN"` rather than dropped. Omitted when the node has no reactions.

## `annotations`

Dev Mode notes, so designer intent reaches the agent. One entry per annotation:
`{ label?, properties? }`, where `properties` lists the **types** of the properties the designer
pinned (`["fills"]`), not their values. `label` is omitted when the note is empty, `properties` when
nothing is pinned, and the block entirely when the node carries no annotations.

## `exportSettings`

How the designer intends the node to be exported: one entry per setting,
`{ format?, suffix?, constraint? }`, with `constraint` as `{ type, value }` — a `@2x` PNG reports
`{ type: "SCALE", value: 2 }`. Omitted when the node has no export settings.

## `renderBounds`

The node's `absoluteRenderBounds` as `{ x, y, width, height }`. Emitted **only when it differs from
`absoluteBoundingBox`** — that is, when a shadow, blur or overflow pushes the rendered area past the
layout box. When the two boxes are identical the render bounds are pure noise, so they are omitted.

## FigJam fields

Nodes that exist only in FigJam carry their meaning outside the geometry, so
[`figjam-serializer.ts`](../../plugin/src/main/figjam-serializer.ts) lifts it onto the top level of the
node. Every field is omitted on every other node type.

| Field          | Node types                                           | Omitted when                                                 |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `text`         | `STICKY`, `SHAPE_WITH_TEXT`, `CONNECTOR` (its label) | The node has no text sublayer                                |
| `text`         | `CODE_BLOCK` (its `code`)                            | Never on a code block                                        |
| `authorName`   | `STICKY`                                             | The sticky's author is hidden (`authorVisible` is `false`)   |
| `shapeType`    | `SHAPE_WITH_TEXT` — `SQUARE`, `DIAMOND`, `ELLIPSE`…  | Never on a shape-with-text                                   |
| `codeLanguage` | `CODE_BLOCK`                                         | Never on a code block                                        |
| `connector`    | `CONNECTOR` — `{ from, to, lineType }`               | Never on a connector                                         |
| `table`        | `TABLE` — rows of cell text, `table[row][column]`    | The table reports no rows or columns (an empty `{}` instead) |

`connector.from` and `connector.to` are the ids of the nodes the connector is attached to, or `null`
for an end that floats free on the canvas. They are what make a board's topology survive the round
trip: without them a flowchart serializes as a pile of unrelated shapes. `SECTION` needs no field of
its own — it is a container, and its children serialize like any other.

## Why the lookups are async

`plugin/manifest.json` declares `documentAccess: "dynamic-page"`, under which the synchronous
accessors this shape needs do not exist. Component identity comes from
`instance.getMainComponentAsync()`, styles from `figma.getStyleByIdAsync()`, and variables from
`figma.variables.getVariableByIdAsync()` plus `figma.variables.getVariableCollectionByIdAsync()`.
`serializeNode` is therefore `async` and every call site awaits it; children are resolved with
`Promise.all` so a wide frame does not serialize one child at a time.

The resolvers short-circuit before touching any lookup when a node carries no reference, so a plain
rectangle never reaches the `figma` global at all. That is what makes the modules behind this shape
— `references.ts`, `component-identity.ts` and `intent.ts` — unit-testable under Bun: they take
their lookups as parameters and never name the `figma` global themselves.
