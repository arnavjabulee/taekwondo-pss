import XCTest
@testable import UoBTKDReplayCamera

final class ReplayCameraTests: XCTestCase {
    func testDesktopQRAndAppLinkProduceSameInvitation() throws {
        let qr = try Invitation(url: XCTUnwrap(URL(string: "http://192.168.0.12:8976/camera#code=123456")))
        let app = try Invitation(url: XCTUnwrap(URL(string: "uobtkd-camera://pair?server=http%3A%2F%2F192.168.0.12%3A8976&code=123456")))
        XCTAssertEqual(qr.server, app.server)
        XCTAssertEqual(qr.code, "123456")
        XCTAssertEqual(app.code, qr.code)
        XCTAssertEqual(qr.server.absoluteString, "http://192.168.0.12:8976")
    }

    func testMalformedInvitationsAreRejected() {
        XCTAssertThrowsError(try Invitation(address: "file:///private", code: "123456"))
        XCTAssertThrowsError(try Invitation(address: "http://user:secret@192.168.0.12", code: "123456"))
        XCTAssertThrowsError(try Invitation(address: "192.168.0.12:8976", code: "12345"))
        XCTAssertThrowsError(try Invitation(address: "192.168.0.12:8976", code: "12345a"))
        XCTAssertThrowsError(try Invitation(address: "192.168.0.12:8976", code: "１２３４５６"))
    }

    func testManualAddress() throws {
        let value = try Invitation(address: "192.168.0.12:8976", code: "654321")
        XCTAssertEqual(value.server.absoluteString, "http://192.168.0.12:8976")
    }

    func testInitializationFiltersStreamingMetadata() throws {
        let ftyp = box("ftyp", Data("isom0000".utf8))
        let moov = box("moov", Data())
        let chunks = try MP4Segments.split(ftyp + box("free", Data([1, 2])) + moov, initialization: true)
        XCTAssertEqual(chunks, [ftyp + moov])
    }

    func testGroupedMediaFragmentsAreSeparated() throws {
        let first = box("moof", Data([1])) + box("mdat", Data([2]))
        let second = box("moof", Data([3])) + box("mdat", Data([4]))
        XCTAssertEqual(try MP4Segments.split(box("styp", Data()) + first + second, initialization: false), [first, second])
    }

    func testTruncatedAndUnpairedFragmentsAreRejected() {
        XCTAssertThrowsError(try MP4Segments.split(Data([0, 0]), initialization: false))
        XCTAssertThrowsError(try MP4Segments.split(box("moof", Data()), initialization: false))
        XCTAssertThrowsError(try MP4Segments.split(box("mdat", Data()), initialization: false))
        XCTAssertThrowsError(try MP4Segments.split(box("moof", Data()) + box("moof", Data()), initialization: false))
        XCTAssertThrowsError(try MP4Segments.split(box("ftyp", Data()), initialization: true))
        XCTAssertThrowsError(try MP4Segments.split(Data([0, 0, 0, 30, 109, 111, 111, 102]), initialization: false))
    }

    private func box(_ type: String, _ payload: Data) -> Data {
        let length = UInt32(payload.count + 8)
        return Data([UInt8((length >> 24) & 255), UInt8((length >> 16) & 255), UInt8((length >> 8) & 255), UInt8(length & 255)]) + Data(type.utf8) + payload
    }
}
