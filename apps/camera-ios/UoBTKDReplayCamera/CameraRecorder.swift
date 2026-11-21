import AVFoundation
import UniformTypeIdentifiers

final class CameraRecorder: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVAssetWriterDelegate {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "uk.ac.bristol.uobtkd.capture")
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var firstTime: CMTime?
    private var captureStart: Double = 0
    private var clockOffset: Double = 0
    private var segmentCount = 0
    private let lock = NSLock()
    private var configured = false
    private var accepting = false
    var onSegment: ((Int, Data, Double) -> Void)?
    var onError: ((Error) -> Void)?

    func prepare() async throws {
        guard await AVCaptureDevice.requestAccess(for: .video) else { throw CameraError.message("Allow camera access in iPhone Settings.") }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    if !self.configured {
                        self.session.beginConfiguration()
                        defer { self.session.commitConfiguration() }
                        self.session.sessionPreset = .hd1280x720
                        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
                            throw CameraError.message("No rear camera is available.")
                        }
                        let source = try AVCaptureDeviceInput(device: device)
                        guard self.session.canAddInput(source) else { throw CameraError.message("Cannot open camera.") }
                        self.session.addInput(source)
                        let output = AVCaptureVideoDataOutput()
                        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
                        output.alwaysDiscardsLateVideoFrames = true
                        output.setSampleBufferDelegate(self, queue: self.queue)
                        guard self.session.canAddOutput(output) else { throw CameraError.message("Cannot capture video.") }
                        self.session.addOutput(output)
                        output.connection(with: .video)?.videoOrientation = .landscapeRight
                        if device.activeFormat.videoSupportedFrameRateRanges.contains(where: { $0.minFrameRate <= 30 && $0.maxFrameRate >= 30 }) {
                            try device.lockForConfiguration()
                            device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
                            device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
                            device.unlockForConfiguration()
                        }
                        self.configured = true
                    }
                    continuation.resume()
                } catch { continuation.resume(throwing: error) }
            }
        }
        queue.async { if !self.session.isRunning { self.session.startRunning() } }
    }

    func start(clockOffset: Double) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    let writer = AVAssetWriter(contentType: UTType.mpeg4Movie)
                    writer.outputFileTypeProfile = .mpeg4AppleHLS
                    writer.preferredOutputSegmentInterval = CMTime(seconds: 1, preferredTimescale: 600)
                    writer.initialSegmentStartTime = .zero
                    writer.delegate = self
                    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                        AVVideoCodecKey: AVVideoCodecType.h264,
                        AVVideoWidthKey: 1280, AVVideoHeightKey: 720,
                        AVVideoCompressionPropertiesKey: [
                            AVVideoAverageBitRateKey: 4_000_000,
                            AVVideoExpectedSourceFrameRateKey: 30,
                            AVVideoMaxKeyFrameIntervalKey: 30,
                            AVVideoAllowFrameReorderingKey: false,
                            AVVideoProfileLevelKey: AVVideoProfileLevelH264BaselineAutoLevel
                        ]
                    ])
                    input.expectsMediaDataInRealTime = true
                    guard writer.canAdd(input) else { throw CameraError.message("H.264 encoding is unavailable.") }
                    writer.add(input)
                    self.lock.lock(); self.segmentCount = 0; self.captureStart = 0; self.lock.unlock()
                    self.firstTime = nil; self.clockOffset = clockOffset
                    self.writer = writer; self.input = input
                    guard writer.startWriting() else { throw writer.error ?? CameraError.message("Cannot start recording.") }
                    writer.startSession(atSourceTime: .zero)
                    self.accepting = true
                    continuation.resume()
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard accepting, let writer, let input else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstTime == nil {
            firstTime = pts
            let age = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock()) - pts)
            lock.lock()
            captureStart = Date().timeIntervalSince1970 * 1000 + clockOffset - ((age >= 0 && age < 5) ? age * 1000 : 0)
            lock.unlock()
        }
        guard input.isReadyForMoreMediaData else { return }
        var timing = CMSampleTimingInfo(duration: CMSampleBufferGetDuration(sampleBuffer), presentationTimeStamp: pts - firstTime!, decodeTimeStamp: .invalid)
        var copy: CMSampleBuffer?
        let status = CMSampleBufferCreateCopyWithNewTiming(allocator: kCFAllocatorDefault, sampleBuffer: sampleBuffer, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &copy)
        guard status == noErr, let copy, input.append(copy) else {
            accepting = false
            onError?(writer.error ?? CameraError.message("Video encoding failed."))
            return
        }
    }

    func assetWriter(_ writer: AVAssetWriter, didOutputSegmentData segmentData: Data, segmentType: AVAssetSegmentType, segmentReport: AVAssetSegmentReport?) {
        do {
            let segments = try MP4Segments.split(segmentData, initialization: segmentType == .initialization)
            for data in segments {
                lock.lock(); let index = segmentCount; segmentCount += 1; let capturedAt = captureStart; lock.unlock()
                onSegment?(index, Data(data), capturedAt)
            }
        } catch { onError?(error) }
    }

    func stop() async -> Int {
        await withCheckedContinuation { continuation in
            queue.async {
                self.accepting = false
                guard let writer = self.writer else { continuation.resume(returning: 0); return }
                guard writer.status == .writing else {
                    self.lock.lock(); let count = self.segmentCount; self.lock.unlock()
                    self.writer = nil; self.input = nil
                    continuation.resume(returning: count)
                    return
                }
                self.input?.markAsFinished()
                writer.finishWriting {
                    self.lock.lock(); let count = self.segmentCount; self.lock.unlock()
                    self.queue.async { self.writer = nil; self.input = nil; continuation.resume(returning: count) }
                }
            }
        }
    }

    func closePreview() { queue.async { if self.session.isRunning { self.session.stopRunning() } } }
}

enum MP4Segments {
    // Apple may group several fragments in one callback. Send each moof/mdat pair separately.
    static func split(_ data: Data, initialization: Bool) throws -> [Data] {
        var offset = 0
        var header = Data()
        var moof: Data?
        var result: [Data] = []
        var headerTypes = Set<String>()
        func number(_ start: Int, _ length: Int) -> UInt64 { data[start..<(start + length)].reduce(0) { ($0 << 8) | UInt64($1) } }
        while offset < data.count {
            guard data.count - offset >= 8 else { throw CameraError.message("Incomplete camera MP4 box.") }
            var size = number(offset, 4)
            let type = String(data: data[(offset + 4)..<(offset + 8)], encoding: .ascii) ?? ""
            var minimum: UInt64 = 8
            if size == 1 {
                guard data.count - offset >= 16 else { throw CameraError.message("Incomplete camera MP4 box.") }
                size = number(offset + 8, 8); minimum = 16
            }
            guard size >= minimum, size <= UInt64(data.count - offset) else { throw CameraError.message("Invalid camera MP4 box.") }
            let box = data.subdata(in: offset..<(offset + Int(size)))
            if initialization && (type == "ftyp" || type == "moov") { header.append(box); headerTypes.insert(type) }
            if !initialization && type == "moof" {
                guard moof == nil else { throw CameraError.message("Camera fragment has no video payload.") }
                moof = box
            }
            if !initialization && type == "mdat" {
                guard var fragment = moof else { throw CameraError.message("Camera fragment has no header.") }
                fragment.append(box); result.append(fragment); moof = nil
            }
            offset += Int(size)
        }
        if initialization {
            guard headerTypes == Set(["ftyp", "moov"]) else { throw CameraError.message("Missing camera MP4 initialization.") }
            return [header]
        }
        guard moof == nil, !result.isEmpty else { throw CameraError.message("Incomplete camera video fragment.") }
        return result
    }
}
