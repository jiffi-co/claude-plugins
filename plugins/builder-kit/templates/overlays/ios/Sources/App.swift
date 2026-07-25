import SwiftUI

// The app entry point. It is named MainApp rather than App because `App` alone
// would collide with the SwiftUI `App` protocol it conforms to.
@main
struct MainApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
