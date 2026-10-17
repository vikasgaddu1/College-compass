import UIKit
import Capacitor

/// The app's bridge view controller (Main.storyboard). Registers plugins that live inside the app
/// target rather than in an npm package.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // Self-serve ChatGPT sign-in: 127.0.0.1 loopback redirect listener (LoopbackAuthPlugin.swift).
        bridge?.registerPluginInstance(LoopbackAuthPlugin())
    }
}
