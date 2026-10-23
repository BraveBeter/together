// Independent map instances release only their own ambient-animation pause.
const activeMaps = new Set<object>();
export const MAP_ACTIVITY_EVENT = "tongye:map-activity";
export function setMapActive(owner: object, active: boolean) {
  if (active) activeMaps.add(owner); else activeMaps.delete(owner);
  window.dispatchEvent(new Event(MAP_ACTIVITY_EVENT));
}
export function isMapActive() { return activeMaps.size > 0; }
