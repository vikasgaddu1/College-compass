import Foundation
import Capacitor
import CryptoKit
import DeviceCheck

/// Apple App Attest for shared-research contributions (protocol: src/data/attest.ts; server:
/// supabase/functions/attest).
///
/// The key pair lives in the Secure Enclave and is usable only by this app; only its identifier is
/// stored here (UserDefaults — App Attest keys don't survive a reinstall or a restore to another
/// device, so neither should the identifier). Client data always arrives as a UTF-8 string and is
/// hashed here with SHA-256, so JavaScript never has to agree with Swift on hashing.
///
/// JS:
/// - `status()` → `{ supported, registered, keyId? }`
/// - `attestKey({ challenge })` → `{ keyId, attestation }` — a NEW key, attested over SHA256(challenge),
///   kept pending until `confirmKey` (a key can be attested only once, so a failed registration simply
///   leads to a fresh key next time).
/// - `confirmKey({ keyId })` — the server accepted it; use it for assertions.
/// - `generateAssertion({ clientData })` → `{ keyId, assertion }` over SHA256(clientData). When Apple
///   reports the key invalid (`DCError.invalidKey`: reinstall, restore, offloaded app update) the key is
///   dropped and the call rejects with code `INVALID_KEY`; the next contribution attests a new one.
/// - `resetKey()` — forget the key (the server doesn't know it).
///
/// Unsupported devices and the Simulator report `supported: false`; contributions are then sent
/// unattested. Base64 strings are standard (not URL-safe) encoding.
@objc(AppAttestPlugin)
public class AppAttestPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppAttestPlugin"
    public let jsName = "AppAttest"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "attestKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirmKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateAssertion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resetKey", returnType: CAPPluginReturnPromise)
    ]

    static let registeredKeyDefault = "cc.appattest.keyId"
    static let pendingKeyDefault = "cc.appattest.pendingKeyId"
    /// Challenges are 43 characters; client data is a contribution (the server caps it at 70 KB).
    static let maxChallengeBytes = 512
    static let maxClientDataBytes = 100_000

    static var defaults: UserDefaults { UserDefaults.standard }
    static var registeredKeyId: String? { defaults.string(forKey: registeredKeyDefault) }

    static func sha256(_ string: String) -> Data {
        Data(SHA256.hash(data: Data(string.utf8)))
    }

    static func isInvalidKey(_ error: Error?) -> Bool {
        guard let dcError = error as? DCError else { return false }
        return dcError.code == .invalidKey
    }

    static func errorCode(_ error: Error?) -> String {
        guard let error = error else { return "UNKNOWN" }
        if isInvalidKey(error) { return "INVALID_KEY" }
        if let dcError = error as? DCError {
            switch dcError.code {
            case .featureUnsupported: return "UNSUPPORTED"
            case .serverUnavailable: return "SERVER_UNAVAILABLE"
            case .invalidInput: return "INVALID_INPUT"
            default: return "UNKNOWN"
            }
        }
        return "UNKNOWN"
    }

    // MARK: - Plugin methods

    @objc func status(_ call: CAPPluginCall) {
        let supported = DCAppAttestService.shared.isSupported
        var result: [String: Any] = ["supported": supported, "registered": false]
        if supported, let keyId = Self.registeredKeyId {
            result["registered"] = true
            result["keyId"] = keyId
        }
        call.resolve(result)
    }

    @objc func attestKey(_ call: CAPPluginCall) {
        let service = DCAppAttestService.shared
        guard service.isSupported else {
            call.reject("App Attest isn't available on this device.", "UNSUPPORTED")
            return
        }
        guard let challenge = call.getString("challenge"), !challenge.isEmpty, challenge.utf8.count <= Self.maxChallengeBytes else {
            call.reject("Missing or invalid challenge.", "INVALID")
            return
        }
        let clientDataHash = Self.sha256(challenge)
        service.generateKey { keyId, error in
            guard let keyId = keyId, error == nil else {
                call.reject("Couldn't create an App Attest key: \(error?.localizedDescription ?? "unknown error")", Self.errorCode(error))
                return
            }
            Self.defaults.set(keyId, forKey: Self.pendingKeyDefault)
            service.attestKey(keyId, clientDataHash: clientDataHash) { attestation, error in
                guard let attestation = attestation, error == nil else {
                    Self.defaults.removeObject(forKey: Self.pendingKeyDefault)
                    call.reject("App Attest attestation failed: \(error?.localizedDescription ?? "unknown error")", Self.errorCode(error))
                    return
                }
                call.resolve(["keyId": keyId, "attestation": attestation.base64EncodedString()])
            }
        }
    }

    @objc func confirmKey(_ call: CAPPluginCall) {
        guard let keyId = call.getString("keyId"), keyId == Self.defaults.string(forKey: Self.pendingKeyDefault) else {
            call.reject("No pending App Attest key with that identifier.", "INVALID")
            return
        }
        Self.defaults.set(keyId, forKey: Self.registeredKeyDefault)
        Self.defaults.removeObject(forKey: Self.pendingKeyDefault)
        call.resolve()
    }

    @objc func generateAssertion(_ call: CAPPluginCall) {
        let service = DCAppAttestService.shared
        guard service.isSupported else {
            call.reject("App Attest isn't available on this device.", "UNSUPPORTED")
            return
        }
        guard let keyId = Self.registeredKeyId else {
            call.reject("No App Attest key yet.", "NO_KEY")
            return
        }
        guard let clientData = call.getString("clientData"), !clientData.isEmpty, clientData.utf8.count <= Self.maxClientDataBytes else {
            call.reject("Missing or oversized client data.", "INVALID")
            return
        }
        service.generateAssertion(keyId, clientDataHash: Self.sha256(clientData)) { assertion, error in
            guard let assertion = assertion, error == nil else {
                if Self.isInvalidKey(error), Self.registeredKeyId == keyId {
                    Self.defaults.removeObject(forKey: Self.registeredKeyDefault)
                }
                call.reject("App Attest assertion failed: \(error?.localizedDescription ?? "unknown error")", Self.errorCode(error))
                return
            }
            call.resolve(["keyId": keyId, "assertion": assertion.base64EncodedString()])
        }
    }

    @objc func resetKey(_ call: CAPPluginCall) {
        Self.defaults.removeObject(forKey: Self.registeredKeyDefault)
        Self.defaults.removeObject(forKey: Self.pendingKeyDefault)
        call.resolve()
    }

    // MARK: - CI self-test

    /// `appattest_supported=true|false` for the simulator smoke test: proves the plugin is compiled in
    /// and DeviceCheck links. The Simulator has no App Attest, so CI expects `false` and asserts nothing more.
    static func selfTestLine() -> String {
        let line = "appattest_supported=\(DCAppAttestService.shared.isSupported)"
        NSLog("CC_APPATTEST %@", line)
        return line
    }
}
