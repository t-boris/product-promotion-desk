// Prints the on-screen windows of ONE process id (argv[1]) as JSON lines: id, layer, bounds. Reads the window list only.
import CoreGraphics
import Foundation
let pid = Int32(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list {
  guard let owner = w[kCGWindowOwnerPID as String] as? Int32, owner == pid else { continue }
  let id = w[kCGWindowNumber as String] as? Int ?? -1
  let layer = w[kCGWindowLayer as String] as? Int ?? -1
  let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
  let onscreen = w[kCGWindowIsOnscreen as String] as? Bool ?? false
  print("{\"id\":\(id),\"layer\":\(layer),\"onscreen\":\(onscreen),\"x\":\(b["X"] ?? 0),\"y\":\(b["Y"] ?? 0),\"w\":\(b["Width"] ?? 0),\"h\":\(b["Height"] ?? 0)}")
}
