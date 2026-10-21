// swift-tools-version: 6.2
// What every family app shares: the family Supabase, one Google sign-in across
// all of them, and the house look.
import PackageDescription

let package = Package(
    name: "MasonKit",
    platforms: [.iOS(.v26)],
    products: [.library(name: "MasonKit", targets: ["MasonKit"])],
    dependencies: [.package(url: "https://github.com/supabase/supabase-swift", from: "2.55.0")],
    targets: [
        .target(name: "MasonKit", dependencies: [.product(name: "Supabase", package: "supabase-swift")]),
    ],
    swiftLanguageModes: [.v5]
)
