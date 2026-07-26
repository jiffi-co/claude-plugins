import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "hammer.fill")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
            Text(Greeting.message(for: "{{PROJECT_NAME}}"))
                .font(.title2)
                .fontWeight(.semibold)
            Text("Built with builder-kit.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

// A tiny pure helper, kept out of the view so it is easy to unit test. Replace
// it with your real logic as the app grows.
enum Greeting {
    static func message(for name: String) -> String {
        name.isEmpty ? "Hello, builder." : "Hello, \(name)."
    }
}

#Preview {
    ContentView()
}
