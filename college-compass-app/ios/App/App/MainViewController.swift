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
        // "Share my list as a PDF": HTML report → Letter PDF → share sheet (SharePdfPlugin.swift).
        let sharePdf = SharePdfPlugin()
        bridge?.registerPluginInstance(sharePdf)
        // Apple App Attest for shared-research contributions (AppAttestPlugin.swift).
        bridge?.registerPluginInstance(AppAttestPlugin())
        if ProcessInfo.processInfo.arguments.contains("-ccNativeHttpSelfTest") {
            // The HTTP checks plus one PDF render of a sample report (`pdf_pages=N pdf_bytes=M`), all
            // written to Documents/cc_nativehttp_selftest.txt for the simulator smoke test.
            http.runSelfTest { record, done in
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    record(SharePdfPlugin.selfTestLine())
                    record(AppAttestPlugin.selfTestLine())
                    done()
                }
            }
        }
    }
}
