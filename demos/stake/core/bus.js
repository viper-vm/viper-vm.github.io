// ============================================================
//  EventBus — tiny pub/sub used to decouple engine from UI.
//  Events: bet:settled, wallet:changed, cashier:changed,
//          seed:rotated, analytics:updated, autobet:tick,
//          autobet:state, toast
// ============================================================

export class EventBus {
  constructor() {
    this._map = new Map();
  }

  on(event, handler) {
    if (!this._map.has(event)) this._map.set(event, new Set());
    this._map.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(event, handler) {
    const set = this._map.get(event);
    if (set) set.delete(handler);
  }

  emit(event, payload) {
    const set = this._map.get(event);
    if (!set) return;
    // Copy so handlers can safely unsubscribe during dispatch.
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[bus] handler for "${event}" threw:`, err);
      }
    }
  }
}

// Single shared bus for the whole app.
export const bus = new EventBus();
