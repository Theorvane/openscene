// swift-tools-version: 5.9
import PackageDescription

/*
  A package that exists so the iOS renderer can be run, not only compiled.

  `Sources/VideoComposer/VideoComposer.swift` is a symlink to the file the app
  builds. There is no copy to drift: the test exports through exactly the code a
  phone exports through, and the pod picks the same file up from `ios/`.

  macOS rather than iOS, because AVFoundation, Core Graphics and Core Animation
  are all there and a Mac runner needs no simulator to run a test that writes a
  real file and measures it.
*/
let package = Package(
  name: "VideoComposer",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "VideoComposer"),
    .testTarget(name: "VideoComposerTests", dependencies: ["VideoComposer"])
  ]
)
