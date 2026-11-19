import Foundation
import Capacitor
import Speech
import AVFoundation

// Dictation inside the app, using the iPhone's own speech recogniser
// (Apple's Speech framework) — so talking to MAX and dictating a site note
// need no speech-to-text key on the server. The web app can't do this
// itself: WKWebView has no working speech recogniser of its own.
//
// Shape of the JavaScript side (src/native/speech.js):
//   available()            → { available }
//   requestPermissions()   → { speechRecognition: "granted" | "denied" | "prompt" }
//   start({ language })    → resolves once listening; results arrive as events
//   stop()                 → ends the audio; the final result follows as an event
//   events: "partialResults" { matches: [text], final }   as the words land
//           "listeningState" { status: "started" | "stopped" }
//
// Registered with the Capacitor bridge by MainViewController.capacitorDidLoad().
// Adapted from @capacitor-community/speech-recognition, which this project
// cannot take as a package (it ships for CocoaPods only; the app is built
// with Swift Package Manager).
@objc(SpeechPlugin)
public class SpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechPlugin"
    public let jsName = "Speech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise)
    ]

    private var recognizer: SFSpeechRecognizer?
    private var audioEngine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    @objc func available(_ call: CAPPluginCall) {
        let r = SFSpeechRecognizer(locale: Locale(identifier: "en-GB")) ?? SFSpeechRecognizer()
        call.resolve(["available": r?.isAvailable ?? false])
    }

    private func permissionWord(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
        switch status {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(["speechRecognition": permissionWord(SFSpeechRecognizer.authorizationStatus())])
    }

    // Both prompts in one go: speech recognition, then the microphone.
    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    call.resolve(["speechRecognition": self.permissionWord(status)])
                    return
                }
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    call.resolve(["speechRecognition": granted ? "granted" : "denied"])
                }
            }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        if let engine = audioEngine, engine.isRunning {
            call.reject("Already listening.", "BUSY")
            return
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            call.reject("Speech recognition isn't allowed for AI QS — turn it on in Settings.", "DENIED")
            return
        }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            guard granted else {
                call.reject("The microphone isn't allowed for AI QS — turn it on in Settings.", "DENIED")
                return
            }
            DispatchQueue.main.async { self.begin(call) }
        }
    }

    private func begin(_ call: CAPPluginCall) {
        let language = call.getString("language") ?? "en-GB"
        tearDown(notify: false)

        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
            call.reject("Speech recognition isn't available on this iPhone right now.", "UNAVAILABLE")
            return
        }
        self.recognizer = recognizer

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.reject("The microphone is in use by another app.", "MIC_BUSY")
            return
        }

        let engine = AVAudioEngine()
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.taskHint = .dictation
        audioEngine = engine
        request = req

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString
                self.notifyListeners("partialResults", data: ["matches": [text], "final": result.isFinal])
                if result.isFinal { self.tearDown(notify: true) }
            }
            if let error = error {
                // A cancelled or ended task reports an error too; the web side
                // already has the last partial result, so only the state matters.
                _ = error
                self.tearDown(notify: true)
            }
        }

        engine.prepare()
        do {
            try engine.start()
            notifyListeners("listeningState", data: ["status": "started"])
            call.resolve()
        } catch {
            tearDown(notify: false)
            call.reject("Could not start the microphone.", "START_FAILED")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Ending the audio lets the recogniser deliver its final result,
            // which arrives through the task handler above.
            if let engine = self.audioEngine, engine.isRunning {
                engine.stop()
                engine.inputNode.removeTap(onBus: 0)
                self.request?.endAudio()
            } else {
                self.tearDown(notify: true)
            }
            call.resolve()
        }
    }

    private func tearDown(notify: Bool) {
        if let engine = audioEngine {
            if engine.isRunning { engine.stop() }
            engine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        let wasListening = audioEngine != nil
        audioEngine = nil
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if notify && wasListening { notifyListeners("listeningState", data: ["status": "stopped"]) }
    }
}
