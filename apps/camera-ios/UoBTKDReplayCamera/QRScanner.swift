import SwiftUI
import AVFoundation

struct QRScanner: UIViewControllerRepresentable {
    let found: (URL) -> Void
    func makeUIViewController(context: Context) -> ScannerController { ScannerController(found: found) }
    func updateUIViewController(_ controller: ScannerController, context: Context) {}
    static func dismantleUIViewController(_ controller: ScannerController, coordinator: ()) { controller.stop() }
}

final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "uk.ac.bristol.uobtkd.qr")
    private let found: (URL) -> Void
    private var preview: AVCaptureVideoPreviewLayer?
    private var delivered = false
    private var closed = false
    private let label = UILabel()
    init(found: @escaping (URL) -> Void) { self.found = found; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        label.text = "Point the camera at the desktop replay camera QR code."
        label.textColor = .white; label.textAlignment = .center; label.numberOfLines = 0
        view.addSubview(label)
        Task {
            guard await AVCaptureDevice.requestAccess(for: .video) else { label.text = "Allow camera access in iPhone Settings."; return }
            queue.async { self.configure() }
        }
    }
    private func configure() {
        guard !closed else { return }
        do {
            guard let device = AVCaptureDevice.default(for: .video) else { throw CameraError.message("No camera is available.") }
            let input = try AVCaptureDeviceInput(device: device)
            let output = AVCaptureMetadataOutput()
            guard session.canAddInput(input), session.canAddOutput(output) else { throw CameraError.message("Cannot scan QR codes.") }
            session.addInput(input); session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            DispatchQueue.main.async {
                let preview = AVCaptureVideoPreviewLayer(session: self.session)
                preview.videoGravity = .resizeAspectFill
                self.view.layer.insertSublayer(preview, at: 0)
                self.preview = preview; self.view.setNeedsLayout()
            }
            session.startRunning()
        } catch { DispatchQueue.main.async { self.label.text = error.localizedDescription } }
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews(); preview?.frame = view.bounds
        preview?.connection?.videoOrientation = .landscapeRight
        label.frame = CGRect(x: 20, y: view.bounds.height - 85, width: view.bounds.width - 40, height: 60)
    }
    func stop() { queue.async { self.closed = true; if self.session.isRunning { self.session.stopRunning() } } }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !delivered else { return }
        for case let object as AVMetadataMachineReadableCodeObject in metadataObjects {
            if let text = object.stringValue, let url = URL(string: text), (try? Invitation(url: url)) != nil {
                delivered = true; stop(); found(url); return
            }
        }
        label.text = "This is not a replay camera invitation. Scan the QR code in desktop replay."
    }
}
