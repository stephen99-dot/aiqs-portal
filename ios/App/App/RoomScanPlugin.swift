import Foundation
import UIKit
import Capacitor
import RoomPlan
// simd_float4x4 is RoomPlan's type for a transform and lives here. SIMD3 comes
// from the standard library, but there is no matrix type there to borrow.
import simd

// Scan a room with the LiDAR sensor and hand the measurements back to the web
// app, which posts them to /api/surveys/rooms/:id/roomplan as a measured room.
//
// The server already knows how to read Apple's RoomPlan shape — it was written
// for exports from Polycam and magicplan — so this deliberately produces the
// same thing rather than inventing a format:
//
//   { walls: [{dimensions:[w,h,d], transform:[16 numbers]}], doors: […],
//     windows: […], openings: […], objects: [{category:"sofa", …}] }
//
// The dictionary is built by hand instead of running CapturedRoom through
// JSONEncoder. Swift encodes an enum without a raw value as a nested object
// ({"sofa": {}}), where the server wants a plain string — and Apple is free to
// change that shape between iOS releases. Building it here keeps the contract
// ours.
//
// This is the Trades Pilot scanner without its textured-USDZ export: AI QS
// keeps the measurements and draws its own plan and 3D view from them, so the
// photo-texturing files (RoomKeyframes, RoomTextures) are not needed here.
//
// Registered with the Capacitor bridge by MainViewController.capacitorDidLoad().
@objc(RoomScanPlugin)
public class RoomScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoomScanPlugin"
    public let jsName = "RoomScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    /// LiDAR is Pro-only hardware, so most phones can't do this at all and the
    /// web app needs to know before it offers the button.
    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 16.0, *) {
            call.resolve(["available": RoomCaptureSession.isSupported])
        } else {
            call.resolve(["available": false])
        }
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *), RoomCaptureSession.isSupported else {
            call.reject("This iPhone doesn't have the LiDAR scanner.", "UNSUPPORTED")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let host = self.bridge?.viewController else {
                call.reject("Could not open the scanner.", "NO_VIEW_CONTROLLER")
                return
            }

            let scanner = RoomScanViewController()
            scanner.onFinish = { [weak scanner] room, error in
                DispatchQueue.main.async {
                    scanner?.dismiss(animated: true)
                    if let error = error {
                        call.reject(error.localizedDescription, "SCAN_FAILED")
                    } else if let room = room {
                        call.resolve([
                            "cancelled": false,
                            "room": RoomScanPlugin.payload(from: room)
                        ])
                    } else {
                        // Backing out is a normal outcome, not a failure — the
                        // web app just returns the builder to the room page.
                        call.resolve(["cancelled": true])
                    }
                }
            }
            scanner.modalPresentationStyle = .fullScreen
            host.present(scanner, animated: true)
        }
    }

    @available(iOS 16.0, *)
    static func payload(from room: CapturedRoom) -> [String: Any] {
        // SIMD3<Float> rather than simd_float3: the same type, but spelled the
        // way the standard library exposes it, so it needs no `import simd`.
        func dims(_ v: SIMD3<Float>) -> [Double] {
            [Double(v.x), Double(v.y), Double(v.z)]
        }
        // Where the thing is and which way it faces, as 16 numbers in the
        // column-major order simd uses. Areas alone can be priced, but a plan
        // can't be drawn without knowing where each wall actually runs.
        // Written out in full rather than mapped over the columns: the compiler
        // gave up trying to type-check the flatMap version in reasonable time.
        func matrix(_ m: simd_float4x4) -> [Double] {
            let c0 = m.columns.0
            let c1 = m.columns.1
            let c2 = m.columns.2
            let c3 = m.columns.3
            var out = [Double]()
            out.reserveCapacity(16)
            out.append(Double(c0.x)); out.append(Double(c0.y)); out.append(Double(c0.z)); out.append(Double(c0.w))
            out.append(Double(c1.x)); out.append(Double(c1.y)); out.append(Double(c1.z)); out.append(Double(c1.w))
            out.append(Double(c2.x)); out.append(Double(c2.y)); out.append(Double(c2.z)); out.append(Double(c2.w))
            out.append(Double(c3.x)); out.append(Double(c3.y)); out.append(Double(c3.z)); out.append(Double(c3.w))
            return out
        }
        func surface(_ s: CapturedRoom.Surface) -> [String: Any] {
            ["dimensions": dims(s.dimensions), "transform": matrix(s.transform)]
        }
        func object(_ o: CapturedRoom.Object) -> [String: Any] {
            // "sofa", "storage", "washerDryer" … the server splits the camel
            // case back into words for the builder to read.
            ["category": String(describing: o.category),
             "dimensions": dims(o.dimensions),
             "transform": matrix(o.transform)]
        }
        return [
            "walls": room.walls.map(surface),
            "doors": room.doors.map(surface),
            "windows": room.windows.map(surface),
            "openings": room.openings.map(surface),
            "objects": room.objects.map(object)
        ]
    }
}

// Apple's own scanning UI (the live wireframe that draws itself over the room)
// with a Done and a Cancel over the top of it.
@available(iOS 16.0, *)
final class RoomScanViewController: UIViewController, RoomCaptureViewDelegate {

    var onFinish: ((CapturedRoom?, Error?) -> Void)?

    private var captureView: RoomCaptureView!
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        captureView = RoomCaptureView(frame: view.bounds)
        captureView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        captureView.delegate = self
        view.addSubview(captureView)

        addButton(title: "Done", action: #selector(doneTapped), alignRight: true)
        addButton(title: "Cancel", action: #selector(cancelTapped), alignRight: false)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    private func addButton(title: String, action: Selector, alignRight: Bool) {
        // UIButton.Configuration rather than the old per-property setters,
        // which iOS 15 deprecated and now ignores on a configured button.
        var config = UIButton.Configuration.plain()
        var styled = AttributedString(title)
        styled.font = .systemFont(ofSize: 17, weight: .semibold)
        config.attributedTitle = styled
        config.baseForegroundColor = .white
        // Readable against a camera feed of anything, including a white wall.
        config.background.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        config.background.cornerRadius = 10
        config.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 18, bottom: 10, trailing: 18)

        let button = UIButton(configuration: config)
        button.addTarget(self, action: action, for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(button)

        NSLayoutConstraint.activate([
            button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            alignRight
                ? button.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20)
                : button.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20)
        ])
    }

    @objc private func doneTapped() {
        // Stopping the session is what triggers RoomPlan to process the scan;
        // the finished room arrives in captureView(didPresent:error:) below.
        captureView.captureSession.stop()
    }

    @objc private func cancelTapped() {
        guard !finished else { return }
        finished = true
        captureView.captureSession.stop()
        onFinish?(nil, nil)
    }

    // Let RoomPlan turn the raw scan into a tidy parametric room.
    func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        return error == nil
    }

    func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        guard !finished else { return }
        finished = true
        onFinish?(error == nil ? processedResult : nil, error)
    }
}
