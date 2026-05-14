/**
 * Custom OpenAPI tool registration loader.
 *
 * Reads tools/openapi.yaml (or any OpenAPI spec) and registers the
 * operations as callable tools for the agent.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface OpenApiTool {
  name: string;
  description: string;
  method: string;
  path: string;
  parameters: Array<{ name: string; in: string; required: boolean; type: string }>;
}

export function loadOpenApiTools(specPath?: string): OpenApiTool[] {
  const path = specPath ?? join(process.cwd(), "tools", "openapi.yaml");
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return [];
  }

  // Very light YAML parsing for paths only
  const tools: OpenApiTool[] = [];
  const pathsMatch = text.match(/paths:\s*([\s\S]*?)(?=^\w|\z)/m);
  if (!pathsMatch) return tools;

  const pathsBlock = pathsMatch[1];
  const pathEntries = pathsBlock.split(/^\s{2}\//m).filter(Boolean);

  for (const entry of pathEntries) {
    const lines = entry.split("\n");
    const apiPath = "/" + lines[0].trim().replace(/:$/, "");
    const methods = ["get", "post", "put", "patch", "delete"];

    for (const method of methods) {
      const mRe = new RegExp(`^\\s{4}${method}:\\s*$`, "m");
      if (!mRe.test(entry)) continue;

      const summaryMatch = entry.match(/summary:\s*(.*)/);
      const descMatch = entry.match(/description:\s*(.*)/);
      const name = (summaryMatch?.[1] ?? descMatch?.[1] ?? `${method}_${apiPath}`)
        .replace(/\W+/g, "_")
        .toLowerCase();

      tools.push({
        name,
        description: descMatch?.[1] ?? summaryMatch?.[1] ?? `${method.toUpperCase()} ${apiPath}`,
        method: method.toUpperCase(),
        path: apiPath,
        parameters: [], // Simplified v1
      });
    }
  }

  return tools;
}
