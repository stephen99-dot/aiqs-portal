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
//   { walls: [{dimensions:[w,h,d]}], doors: […], windows: […],
//     openings: […], objects: [{category:"sofa", dimensions:[w,h,d]}] }
//
// The dictionary is built by hand instead of running CapturedRoom through
// JSONEncoder. Swift encodes an enum without a raw value as a nested object
// ({"sofa": {}}), where the server wants a plain string — and Apple is free to
// change that shape between iOS releases. Building it here keeps the contract
// ours.
@objc(RoomScanPlugin)
public class RoomScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoomScanPlugin"
    public let jsName = "RoomScan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportModel", returnType: CAPPluginReturnPromise)
    ]

    /// The last room scanned, kept so its 3D model can be written on demand
    /// rather than exporting a file after every scan whether it's wanted or
    /// not. Held as Any? because a stored property can't carry an @available
    /// type on a class that has to compile against iOS 15.
    private var lastRoom: Any?
    /// The photographs that went with it, for texturing the exported model.
    private var lastKeyframes: Any?

    /// Covering the model in photographs of the real room is switched off.
    ///
    /// It worked — the walls genuinely carried their own pictures — but the
    /// result was not yet worth what it cost: floors smeared, exposure jumped
    /// between shots, and collecting three dozen frames taxed the scan. The
    /// measurements and what the room contains are the parts that earn their
    /// keep, so the model is clean geometry for now.
    ///
    /// Setting this back to true re-enables the whole path: frame collection,
    /// the textured USDZ, and (with the matching flag in RoomView3D.js) the
    /// projected surfaces in the viewer.
    static let photoTexturing = false

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
                        self.lastRoom = room
                        self.lastKeyframes = RoomScanPlugin.photoTexturing
                            ? (scanner?.keyframes.frames ?? [])
                            : []
                        var result: [String: Any] = [
                            "cancelled": false,
                            "room": RoomScanPlugin.payload(from: room)
                        ]
                        // Written into a folder of their own so a second scan
                        // can't be textured with the first one's photographs.
                        let folder = FileManager.default.temporaryDirectory
                            .appendingPathComponent("roomscan-\(Int(Date().timeIntervalSince1970))")
                        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                        result["keyframes"] = RoomScanPlugin.photoTexturing
                            ? (scanner?.keyframes.export(into: folder) ?? [])
                            : []
                        call.resolve(result)
                    } else {
                        // Backing out is a normal outcome, not a failure — the
                        // web app just returns the builder to the scan screen.
                        call.resolve(["cancelled": true])
                    }
                }
            }
            scanner.modalPresentationStyle = .fullScreen
            host.present(scanner, animated: true)
        }
    }

    /// Write the last scan out as a USDZ — the format iOS previews natively,
    /// so a client can be sent the 3D model and just tap it open.
    @objc func exportModel(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *), let room = lastRoom as? CapturedRoom else {
            call.reject("Scan a room first.", "NO_SCAN")
            return
        }
        let name = (call.getString("name") ?? "room").replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).usdz")
        try? FileManager.default.removeItem(at: url)

        // Textures have to live somewhere on disk while the model is written.
        let workshop = FileManager.default.temporaryDirectory
            .appendingPathComponent("usdz-\(Int(Date().timeIntervalSince1970))")
        try? FileManager.default.createDirectory(at: workshop, withIntermediateDirectories: true)

        let frames = RoomScanPlugin.photoTexturing
            ? ((lastKeyframes as? [RoomKeyframeCollector.Keyframe]) ?? [])
            : []
        if !frames.isEmpty {
            // Each surface gets the photograph that saw it, warped flat, so
            // whoever opens the file sees the actual room rather than boxes.
            do {
                try RoomTextures.exportTextured(
                    room: room, keyframes: frames, to: url, workingDirectory: workshop
                )
                call.resolve(["path": url.path, "uri": url.absoluteString, "textured": true])
                return
            } catch {
                // Fall through to RoomPlan's own export rather than sending
                // the builder away with nothing.
                print("[RoomScan] textured export failed, falling back: \(error)")
                try? FileManager.default.removeItem(at: url)
            }
        }

        do {
            // No photographs, or texturing failed. `.model` at least carries
            // the mesh the LiDAR measured, so bay windows and chimney breasts
            // survive even without their surfaces.
            try room.export(to: url, exportOptions: .model)
            call.resolve(["path": url.path, "uri": url.absoluteString, "textured": false])
        } catch {
            call.reject("Could not save the 3D model: \(error.localizedDescription)", "EXPORT_FAILED")
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
    // Photographs of the room, each tagged with where the camera was, so the
    // walls can be covered in pictures of themselves afterwards.
    let keyframes = RoomKeyframeCollector()

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
        // Sampling frames costs battery and memory throughout the scan, so it
        // only runs when something is going to use them.
        if RoomScanPlugin.photoTexturing {
            keyframes.start(session: captureView.captureSession.arSession)
        }
    }

    deinit {
        keyframes.stop()
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
        keyframes.stop()
        captureView.captureSession.stop()
    }

    @objc private func cancelTapped() {
        guard !finished else { return }
        finished = true
        keyframes.stop()
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
