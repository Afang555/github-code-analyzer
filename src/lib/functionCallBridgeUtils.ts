import type {
  FunctionCallBridgeMetadata,
  FunctionCallNode,
} from "@/types/aiAnalysis";

export const FUNCTION_CALL_BRIDGE_NODE_TYPES = {
  frameworkEntry: "framework_entry",
  routeHandler: "route_handler",
  controllerHandler: "route_handler",
} as const;

export function formatFunctionCallRouteLabel(args: {
  routePath: string | null;
  routeMethods: string[];
}): string | null {
  if (!args.routePath) {
    return null;
  }

  const methodLabel = args.routeMethods.join(",");
  return methodLabel ? `${methodLabel} ${args.routePath}` : args.routePath;
}

export function getFunctionCallBridgeRouteLabel(
  metadata: FunctionCallBridgeMetadata | null,
): string | null {
  if (!metadata) {
    return null;
  }

  return formatFunctionCallRouteLabel({
    routePath: metadata.routePath,
    routeMethods: metadata.routeMethods,
  });
}

export function getFunctionCallNodeRouteLabel(
  node: Pick<FunctionCallNode, "bridgeMetadata">,
): string | null {
  return getFunctionCallBridgeRouteLabel(node.bridgeMetadata);
}
