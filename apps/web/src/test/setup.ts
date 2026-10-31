// The controller listens for online/offline on window; node has no window.
if (typeof globalThis.window === "undefined") {
  (globalThis as unknown as { window: EventTarget }).window = new EventTarget();
}
