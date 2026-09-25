export function attachHostBridge(transport, actions) {
  const report = (type, extra = {}) => transport.postMessage({ type, ...actions.status(), ...extra });
  transport.addEventListener("message", event => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "configure":
        for (const name of ["count", "speed", "interaction", "fps"]) {
          if (Object.hasOwn(message, name)) actions.configure(name, message[name]);
        }
        if (typeof message.paused === "boolean") actions.pause(message.paused);
        report("configured");
        break;
      case "pointer":
        if (typeof message.active !== "boolean") return;
        if (!Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
        actions.pointer({
          x: Math.min(1, Math.max(0, message.x)),
          y: Math.min(1, Math.max(0, message.y)),
          active: message.active,
        });
        break;
      case "pause":
        if (typeof message.paused === "boolean") actions.pause(message.paused);
        break;
      case "status":
        report("status");
        break;
      default:
        break;
    }
  });
  return { ready: () => report("ready"), error: error => report("error", { error: String(error) }) };
}
