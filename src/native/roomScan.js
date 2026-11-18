// Scanning a room with the phone's LiDAR sensor (iPhone 12 Pro and later,
// iPad Pro). The native half is ios/App/App/RoomScanPlugin.swift, a Capacitor
// plugin around Apple's RoomPlan: the builder walks the room, the wireframe
// draws itself over the camera feed, and the plugin hands back walls, doors,
// windows and furniture measured in metres — the RoomPlan shape the server
// already reads at POST /api/surveys/rooms/:id/roomplan.
//
// On the web, on Android, and on a phone without the sensor, `available` is
// false with a reason the page can show, and photos stay the way in.
import { registerPlugin } from '@capacitor/core';
import { isNative, hasPlugin } from './platform';

const RoomScan = registerPlugin('RoomScan');

export async function lidarStatus() {
  if (!isNative()) return { available: false, reason: 'LiDAR scanning works in the AI QS app on an iPhone Pro or iPad Pro. Here, add photos or import a RoomPlan scan file.' };
  if (!hasPlugin('RoomScan')) return { available: false, reason: 'This build of the app has no LiDAR scanner yet — add photos, or import a scan exported from Polycam or magicplan.' };
  try {
    const res = await RoomScan.isAvailable();
    return res && res.available ? { available: true, reason: '' } : { available: false, reason: 'This device has no LiDAR sensor — LiDAR needs an iPhone 12 Pro or later, or an iPad Pro.' };
  } catch (e) {
    return { available: false, reason: 'Scanner error: ' + (e && e.message ? e.message : String(e)) };
  }
}

// Resolves to the RoomPlan capture, or null if the builder backed out.
export async function scanRoom() {
  const { cancelled, room } = await RoomScan.scan();
  if (cancelled || !room) return null;
  return room;
}
