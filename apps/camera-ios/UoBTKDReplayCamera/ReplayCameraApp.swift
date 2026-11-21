import SwiftUI
import AVFoundation

@main struct ReplayCameraApp: App {
    @StateObject private var model = CameraModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            CameraScreen(model: model)
                .preferredColorScheme(.dark)
                .onOpenURL { model.invitation($0) }
                .onReceive(NotificationCenter.default.publisher(for: AVCaptureSession.wasInterruptedNotification, object: model.recorder.session)) { _ in
                    Task { await model.stop() }
                }
                .onReceive(NotificationCenter.default.publisher(for: AVCaptureSession.runtimeErrorNotification, object: model.recorder.session)) { _ in
                    Task { await model.stop() }
                }
                .onChange(of: phase) { value in
                    if value == .background { Task { await model.stop(); model.recorder.closePreview() } }
                }
        }
    }
}

struct CameraScreen: View {
    @ObservedObject var model: CameraModel
    @State private var scanning = false
    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("UoBTKD").font(.title2.bold())
                    Text("REPLAY CAMERA").font(.caption).foregroundStyle(.secondary)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) {
                            TextField("Desktop address", text: $model.address).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            TextField("Camera code", text: $model.code).keyboardType(.numberPad)
                            TextField("Camera name", text: $model.name)
                            HStack {
                                Button("Scan QR") { scanning = true }
                                Button("Pair camera") { hideKeyboard(); Task { await model.pair() } }
                            }.buttonStyle(.bordered)
                        }.textFieldStyle(.roundedBorder).disabled(model.busy || model.recording)
                        Text(model.status).font(.callout).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 8).accessibilityIdentifier("camera-status")
                    }
                    Button(model.recording ? "Stop recording" : "Start recording") {
                        hideKeyboard()
                        Task { if model.recording { await model.stop() } else { await model.start() } }
                    }
                    .buttonStyle(.borderedProminent).tint(model.recording ? .red : .blue)
                    .disabled(model.busy || (!model.recording && !model.approved))
                }.frame(width: min(320, geometry.size.width * 0.38))
                CameraPreview(session: model.recorder.session)
                    .background(.black).clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(alignment: .topLeading) {
                        if model.recording { Label("REC", systemImage: "record.circle.fill").foregroundStyle(.red).padding(12).background(.black.opacity(0.65)).clipShape(Capsule()).padding(12) }
                    }
            }.padding(20).background(Color(white: 0.055))
        }
        .sheet(isPresented: $scanning) {
            QRScanner { url in model.invitation(url); scanning = false }
                .overlay(alignment: .topTrailing) { Button("Cancel") { scanning = false }.buttonStyle(.borderedProminent).padding() }
        }
    }
    private func hideKeyboard() { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
}

final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    override func layoutSubviews() {
        super.layoutSubviews()
        preview.connection?.videoOrientation = .landscapeRight
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.preview.videoGravity = .resizeAspect
        view.preview.session = session
        return view
    }
    func updateUIView(_ view: PreviewView, context: Context) {}
}
