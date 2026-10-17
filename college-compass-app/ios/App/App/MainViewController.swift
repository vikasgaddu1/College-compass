import UIKit
import Capacitor

/// The app's bridge view controller (Main.storyboard). Registers plugins that live inside the app
/// target rather than in an npm package.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // Self-serve ChatGPT sign-in: 127.0.0.1 loopback redirect listener (LoopbackAuthPlugin.swift).
        let loopback = LoopbackAuthPlugin()
        bridge?.registerPluginInstance(loopback)
        // CI smoke test only: `xcrun simctl launch ... -ccLoopbackSelfTest` starts the listener at launch.
        if ProcessInfo.processInfo.arguments.contains("-ccLoopbackSelfTest") {
            loopback.startSelfTest()
        }
        // OpenAI requests (api.openai.com has no CORS for authenticated calls): NativeHttpPlugin.swift.
        let http = NativeHttpPlugin()
        bridge?.registerPluginInstance(http)
        if ProcessInfo.processInfo.arguments.contains("-ccNativeHttpSelfTest") {
            http.runSelfTest()
        }
    }
}
