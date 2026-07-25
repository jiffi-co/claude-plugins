import XCTest
@testable import AppModule

// One passing test to prove the target wiring works end to end: the test bundle
// builds, hosts on the app, imports its module, and runs. Add real tests here.
final class AppTests: XCTestCase {
    func testGreetingMessage() {
        XCTAssertEqual(Greeting.message(for: "Jiffi"), "Hello, Jiffi.")
        XCTAssertEqual(Greeting.message(for: ""), "Hello, builder.")
    }
}
