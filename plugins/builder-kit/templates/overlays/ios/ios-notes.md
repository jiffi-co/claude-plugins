# iOS toolchain notes for {{PROJECT_NAME}}

This is a SwiftUI app scaffolded by builder-kit. The Xcode project is generated
from `project.yml` by XcodeGen, so the checked-in source of truth is the spec and
the Swift files, not a `.xcodeproj`.

## What you need

- **Xcode** (from the Mac App Store or developer.apple.com). Brings the Swift
  compiler, the iOS SDK, and the Simulator. Run `xcode-select --install` once for
  the command line tools if you have not already.
- **XcodeGen** (not bundled with the plugin, install it yourself):
  `brew install xcodegen`. Turns `project.yml` into the `.xcodeproj`.
- **The iOS Simulator**, which ships inside Xcode. List what you have with
  `xcrun simctl list devices available`.

`/jiffi-doctor` checks this toolchain for you (Xcode, Swift, a simulator) before
you start.

## Generate and run

```bash
xcodegen generate                 # writes {{PROJECT_NAME}}.xcodeproj from project.yml
open {{PROJECT_NAME}}.xcodeproj    # then pick a simulator and press Run
```

Regenerate whenever you change `project.yml` or add or remove source files. Do not
hand-edit the `.xcodeproj`; your changes would be overwritten on the next generate.

## Build and test from the command line

Tests need a concrete simulator destination. Pick one from
`xcodebuild -showdestinations -scheme {{PROJECT_NAME}}` and swap the name below to
one your Xcode actually has.

```bash
xcodebuild -scheme {{PROJECT_NAME}} \
  -destination 'platform=iOS Simulator,name=iPhone 16' build

xcodebuild -scheme {{PROJECT_NAME}} \
  -destination 'platform=iOS Simulator,name=iPhone 16' test
```

Simulator builds are not code signed, so both commands work with no Apple account
and no signing setup.

## Shipping to TestFlight

Shipping means archiving a signed build and uploading it to App Store Connect,
where TestFlight distributes it to testers. Unlike the simulator flow above, this
needs an Apple Developer Program membership, the bundle id registered in App Store
Connect, and signing configured (a development team, set in Xcode under Signing &
Capabilities, or via `DEVELOPMENT_TEAM` in `project.yml`).

The plugin does not bundle any release tooling. The real paths are:

- **Xcode**: Product > Archive, then in the Organizer choose Distribute App >
  TestFlight & App Store.
- **Command line**: `xcodebuild archive` then `xcodebuild -exportArchive` with an
  export options plist, then upload the resulting `.ipa` with the Transporter app,
  `xcrun altool --upload-app`, or fastlane's `pilot` if you have added fastlane.

## A note on .gitignore

The scaffolded `.gitignore` is web oriented. For iOS you will want to ignore the
generated project and build output. Add these lines:

```
{{PROJECT_NAME}}.xcodeproj/
DerivedData/
*.ipa
*.xcarchive
```
