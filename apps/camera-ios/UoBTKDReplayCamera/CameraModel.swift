import SwiftUI
import AVFoundation

@MainActor final class CameraModel: ObservableObject {
    @Published var address = ""
    @Published var code = ""
    @Published var name = UIDevice.current.name
    @Published var status = "Scan the camera QR code in desktop replay, or enter the address and camera code."
    @Published var paired = false
    @Published var approved = false
    @Published var recording = false
    @Published var busy = false
    let recorder = CameraRecorder()
    private var client: BridgeClient?
    private var uploader: FragmentUploader?
    private var polling: Task<Void, Never>?

    func invitation(_ url: URL) {
        guard !recording, !busy else { status = "Stop recording before changing the connection."; return }
        do {
            let value = try Invitation(url: url)
            address = value.server.absoluteString; code = value.code
            status = "Invitation loaded. Tap Pair camera."
        } catch { status = error.localizedDescription }
    }

    func pair() async {
        guard !busy, !recording else { return }
        busy = true
        defer { busy = false }
        polling?.cancel(); approved = false; paired = false
        do {
            let invitation = try Invitation(address: address.trimmingCharacters(in: .whitespacesAndNewlines), code: code.trimmingCharacters(in: .whitespacesAndNewlines))
            var connection = BridgeClient(server: invitation.server)
            if let existing = client, existing.server == invitation.server,
               let state: CameraState = try? await existing.json("/api/camera/state") {
                connection = existing
                approved = state.approved
            } else {
                let response: PairResponse = try await connection.json("/api/camera/pair", method: "POST", fields: ["code": invitation.code, "name": String(name.prefix(64))])
                connection.token = response.token
            }
            client = connection; paired = true
            status = "Waiting for camera approval on the desktop."
            polling = Task { [weak self] in
                var failures = 0
                while !Task.isCancelled {
                    do {
                        let state: CameraState = try await connection.json("/api/camera/state")
                        guard !Task.isCancelled else { return }
                        failures = 0
                        guard let self else { return }
                        self.approved = state.approved
                        if !self.recording && !self.busy { self.status = state.approved ? "Approved. Ready to record." : "Waiting for desktop approval." }
                    } catch {
                        guard !Task.isCancelled else { return }
                        failures += 1
                        if failures >= 2 {
                            guard let self else { return }
                            if self.recording { await self.stop() }
                            self.approved = false; self.paired = false
                            self.status = "Connection lost. Check the network and pair again."
                            return
                        }
                    }
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                }
            }
        } catch { status = error.localizedDescription }
    }

    func start() async {
        guard approved, !busy, !recording, let client else { return }
        busy = true
        var startedGeneration: String?
        var writerStarted = false
        defer { busy = false }
        do {
            try await recorder.prepare()
            guard UIApplication.shared.applicationState == .active else { throw CameraError.message("Keep the camera app open to record.") }
            let sentAt = Date().timeIntervalSince1970 * 1000
            let response: StartResponse = try await client.json("/api/camera/start", method: "POST", fields: [:])
            startedGeneration = response.generation
            guard UIApplication.shared.applicationState == .active else { throw CameraError.message("Keep the camera app open to record.") }
            let offset = response.serverTime - (sentAt + Date().timeIntervalSince1970 * 1000) / 2
            let uploader = FragmentUploader(client: client, generation: response.generation)
            self.uploader = uploader
            recorder.onSegment = { [weak self] index, data, capturedAt in
                Task {
                    do { try await uploader.enqueue(index: index, data: data, capturedAt: capturedAt) }
                    catch { await self?.captureFailed(error) }
                }
            }
            recorder.onError = { [weak self] error in Task { await self?.captureFailed(error) } }
            try await recorder.start(clockOffset: offset)
            writerStarted = true
            guard UIApplication.shared.applicationState == .active else { throw CameraError.message("Recording stopped because the app left the foreground.") }
            recording = true
            UIApplication.shared.isIdleTimerDisabled = true
            status = "Recording · 720p · 30 fps · video only"
        } catch {
            if writerStarted { let count = await recorder.stop(); try? await uploader?.finish(count: count) }
            if let generation = startedGeneration { _ = try? await client.request("/api/camera/stop?generation=\(generation)", method: "POST", body: Data("{}".utf8)) }
            uploader = nil
            recorder.closePreview(); status = error.localizedDescription
        }
    }

    func stop() async {
        guard recording, !busy else { return }
        busy = true; recording = false
        status = "Finishing recording…"
        let background = UIApplication.shared.beginBackgroundTask(withName: "Finish replay upload")
        defer {
            if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
            busy = false; UIApplication.shared.isIdleTimerDisabled = false
            recorder.closePreview()
        }
        let count = await recorder.stop()
        do { try await uploader?.finish(count: count); status = "Recording saved on the desktop." }
        catch { status = error.localizedDescription }
        uploader = nil
    }

    private func captureFailed(_ error: Error) async {
        guard recording else { return }
        await stop()
        status = error.localizedDescription
    }
}
