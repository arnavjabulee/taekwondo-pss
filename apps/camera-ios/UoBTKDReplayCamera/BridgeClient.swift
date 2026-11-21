import Foundation

struct Invitation {
    let server: URL
    let code: String

    init(address: String, code: String) throws {
        let text = address.contains("://") ? address : "http://" + address
        guard let parts = URLComponents(string: text), parts.scheme == "http" || parts.scheme == "https",
              parts.host != nil, parts.user == nil, parts.password == nil,
              let origin = URL(string: "\(parts.scheme!)://\(parts.host!.contains(":") ? "[\(parts.host!)]" : parts.host!)\(parts.port.map { ":\($0)" } ?? "")"),
              code.count == 6, code.allSatisfy({ $0.isASCII && $0.isNumber }) else {
            throw CameraError.message("Enter a desktop address and its six-digit camera code.")
        }
        self.server = origin
        self.code = code
    }

    init(url: URL) throws {
        let parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let custom = url.scheme == "uobtkd-camera"
        let items = custom ? parts?.queryItems : URLComponents(string: "?" + (parts?.fragment ?? ""))?.queryItems
        let code = items?.first(where: { $0.name == "code" })?.value ?? ""
        let address = custom ? items?.first(where: { $0.name == "server" })?.value ?? "" : url.absoluteString
        try self.init(address: address, code: code)
    }
}

enum CameraError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

struct PairResponse: Decodable { let token: String }
struct CameraState: Decodable { let approved: Bool; let generation: String? }
struct StartResponse: Decodable { let generation: String; let serverTime: Double }

struct BridgeClient {
    let server: URL
    var token: String = ""

    func request(_ path: String, method: String = "GET", body: Data? = nil, video: Bool = false) async throws -> Data {
        guard let url = URL(string: path, relativeTo: server) else { throw CameraError.message("Invalid desktop address.") }
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.httpMethod = method
        request.httpBody = body
        request.setValue(video ? "video/mp4" : "application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw CameraError.message(message ?? "The desktop rejected the request. Check pairing and connection.")
        }
        return data
    }

    func json<T: Decodable>(_ path: String, method: String = "GET", fields: [String: String]? = nil) async throws -> T {
        let body = try fields.map { try JSONSerialization.data(withJSONObject: $0) }
        return try JSONDecoder().decode(T.self, from: await request(path, method: method, body: body))
    }
}

// One drain loop preserves fragment order across slow or reentrant network requests.
actor FragmentUploader {
    private let client: BridgeClient
    private let generation: String
    private var pending: [Int: (Data, Double)] = [:]
    private var next = 0
    private var draining = false
    private var failure: Error?

    init(client: BridgeClient, generation: String) { self.client = client; self.generation = generation }

    func enqueue(index: Int, data: Data, capturedAt: Double) async throws {
        if let failure { throw failure }
        guard pending.count < 8, data.count <= 8 * 1024 * 1024 else {
            let error = CameraError.message("The connection cannot keep up with the camera. Recording stopped.")
            failure = error
            pending.removeAll()
            throw error
        }
        pending[index] = (data, capturedAt)
        guard !draining else { return }
        draining = true
        defer { draining = false }
        do {
            while failure == nil, let (data, capturedAt) = pending.removeValue(forKey: next) {
                let path = "/api/camera/chunk?generation=\(generation)&index=\(next)&captureStartMs=\(Int64(capturedAt))"
                _ = try await client.request(path, method: "POST", body: data, video: true)
                next += 1
            }
        } catch { failure = error; pending.removeAll(); throw error }
    }

    func finish(count: Int) async throws {
        // The recorder has finished producing data; allow already scheduled callbacks to drain.
        let deadline = Date().addingTimeInterval(15)
        while next < count && failure == nil && Date() < deadline { try await Task.sleep(nanoseconds: 50_000_000) }
        _ = try? await client.request("/api/camera/stop?generation=\(generation)", method: "POST", body: Data("{}".utf8))
        if let failure { throw failure }
        guard next == count else { throw CameraError.message("The final video fragments could not be uploaded.") }
    }
}
