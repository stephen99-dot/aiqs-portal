import UIKit
import Capacitor

// The app's own bridge view controller, so plugins that live in this target —
// rather than in an npm package — can be registered.
//
// Capacitor discovers the plugins it installs from node_modules through
// Package.swift. It does not go looking for classes compiled into the app
// itself, so RoomScanPlugin would build and link perfectly and still answer
// `"RoomScan" plugin is not implemented on iOS`: nothing had told the bridge
// it existed. capacitorDidLoad() is the hook for saying so.
//
// SceneDelegate creates this instead of a bare CAPBridgeViewController, and
// Main.storyboard points at it too for the same reason.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(RoomScanPlugin())   // LiDAR room scanning
        bridge?.registerPluginInstance(SpeechPlugin())     // dictation (talk to MAX, site notes)
    }
}
