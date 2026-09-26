/**
 * Serializes the node types that exist only in FigJam.
 *
 * Connector endpoints are the point of this module. Without them a board
 * serializes as unrelated shapes and every diagram loses its topology — which
 * is the only part of a diagram that carries meaning.
 *
 * Sections need nothing here: they are containers, and the main serializer
 * already walks their children.
 */

export interface FigJamFields {
  text?: string;
  authorName?: string;
  shapeType?: string;
  codeLanguage?: string;
  connector?: {
    /** Endpoint node id, or null when the endpoint floats free. */
    from: string | null;
    to: string | null;
    lineType?: string;
  };
  table?: string[][];
}

type Raw = Record<string, unknown>;

const textOf = (node: Raw): string | undefined => {
  const text = node.text as { characters?: string } | undefined;
  return typeof text?.characters === "string" ? text.characters : undefined;
};

const endpointId = (endpoint: unknown): string | null => {
  const value = endpoint as { endpointNodeId?: string } | undefined;
  return typeof value?.endpointNodeId === "string" ? value.endpointNodeId : null;
};

/**
 * Extracts the FigJam-specific fields of a node.
 * @param node - The raw scene node.
 * @returns The fields, or undefined when the node is not a FigJam type.
 */
export const serializeFigJamNode = (node: Raw): FigJamFields | undefined => {
  switch (node.type) {
    case "STICKY": {
      const fields: FigJamFields = {};
      const text = textOf(node);
      if (text !== undefined) fields.text = text;
      if (node.authorVisible === true && typeof node.authorName === "string") {
        fields.authorName = node.authorName;
      }
      return fields;
    }

    case "CONNECTOR": {
      const fields: FigJamFields = {
        connector: {
          from: endpointId(node.connectorStart),
          to: endpointId(node.connectorEnd),
          lineType: typeof node.connectorLineType === "string" ? node.connectorLineType : undefined,
        },
      };
      const text = textOf(node);
      if (text !== undefined) fields.text = text;
      return fields;
    }

    case "SHAPE_WITH_TEXT": {
      const fields: FigJamFields = {};
      const text = textOf(node);
      if (text !== undefined) fields.text = text;
      if (typeof node.shapeType === "string") fields.shapeType = node.shapeType;
      return fields;
    }

    case "CODE_BLOCK": {
      const fields: FigJamFields = {};
      if (typeof node.code === "string") fields.text = node.code;
      if (typeof node.codeLanguage === "string") fields.codeLanguage = node.codeLanguage;
      return fields;
    }

    case "TABLE": {
      const rows = typeof node.numRows === "number" ? node.numRows : 0;
      const columns = typeof node.numColumns === "number" ? node.numColumns : 0;
      const cellAt = node.cellAt as ((r: number, c: number) => Raw) | undefined;
      if (!cellAt || rows === 0 || columns === 0) return {};
      const table: string[][] = [];
      for (let row = 0; row < rows; row++) {
        const line: string[] = [];
        for (let column = 0; column < columns; column++) {
          line.push(textOf(cellAt.call(node, row, column)) ?? "");
        }
        table.push(line);
      }
      return { table };
    }

    default:
      return undefined;
  }
};
