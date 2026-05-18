import { BRIDGE_TAG } from "../../shared/constants";
import type {
  BridgeToHostMessage,
  HostToBridgeMessage,
} from "../../shared/types";

export function isBridgeMessage(data: unknown): data is BridgeToHostMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)[BRIDGE_TAG] === true &&
    typeof (data as Record<string, unknown>).type === "string"
  );
}

export function sendToBridge(
  iframe: HTMLIFrameElement | null,
  msg: HostToBridgeMessage,
): void {
  if (!iframe?.contentWindow) return;
  iframe.contentWindow.postMessage({ [BRIDGE_TAG]: true, ...msg }, "*");
}
