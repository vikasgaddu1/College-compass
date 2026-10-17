import Foundation
import Capacitor

/// Cancellable HTTPS requests for the app's OpenAI calls.
///
/// api.openai.com does not send CORS headers for authenticated requests, so the WebView's `fetch`
/// cannot reach it. JavaScript calls this plugin instead (see `src/platform/index.ts` →
/// `httpFetch`). Each request carries a caller-chosen `id`; `cancel({ id })` cancels the underlying
/// URLSession task, which closes the connection so OpenAI stops generating (and stops counting
/// against the user's ChatGPT plan) when the student stops research or chat.
///
/// JS: `request({ id, url, method?, headers?, body?, timeoutMs? }) -> { status, headers, data }`
/// (rejects with code `ABORTED` after `cancel`, `NETWORK` on transport errors), `cancel({ id })`.
/// The response body is returned whole as UTF-8 text.
@objc(NativeHttpPlugin)
public class NativeHttpPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeHttpPlugin"
    public let jsName = "NativeHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private let lock = NSLock()
    private var tasks: [String: URLSessionDataTask] = [:]
    /// Ids cancelled before their request started (cancel raced request).
    private var cancelledEarly: Set<String> = []

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 300
        config.timeoutIntervalForResource = 600
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.httpShouldSetCookies = false
        return URLSession(configuration: config)
    }()

    // MARK: - Plugin methods

    @objc func request(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("Missing request id", "INVALID")
            return
        }
        guard let urlString = call.getString("url"), let url = URL(string: urlString),
              url.scheme?.lowercased() == "https" else {
            call.reject("Only https URLs are allowed", "INVALID")
            return
        }
        var req = URLRequest(url: url)
        req.httpMethod = (call.getString("method") ?? "GET").uppercased()
        if let headers = call.getObject("headers") {
            for (name, value) in headers {
                if let s = value as? String { req.setValue(s, forHTTPHeaderField: name) }
            }
        }
        if let body = call.getString("body") { req.httpBody = Data(body.utf8) }
        if let ms = call.getDouble("timeoutMs"), ms > 0 { req.timeoutInterval = ms / 1000 }

        perform(req, id: id) { result in
            switch result {
            case .success(let payload): call.resolve(payload)
            case .failure(let failure): call.reject(failure.message, failure.code)
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        cancel(id: call.getString("id") ?? "")
        call.resolve()
    }

    // MARK: - Core (also used by the CI self-test)

    struct Failure: Error {
        let code: String
        let message: String
    }

    func perform(_ req: URLRequest, id: String, completion: @escaping (Result<[String: Any], Failure>) -> Void) {
        let task = session.dataTask(with: req) { [weak self] data, response, error in
            self?.forget(id)
            if let error = error as NSError? {
                if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled {
                    completion(.failure(Failure(code: "ABORTED", message: "Aborted")))
                } else {
                    completion(.failure(Failure(code: "NETWORK", message: error.localizedDescription)))
                }
                return
            }
            guard let http = response as? HTTPURLResponse else {
                completion(.failure(Failure(code: "NETWORK", message: "No HTTP response")))
                return
            }
            var headers: [String: String] = [:]
            for (key, value) in http.allHeaderFields {
                headers[String(describing: key)] = String(describing: value)
            }
            let text = data.map { String(decoding: $0, as: UTF8.self) } ?? ""
            completion(.success(["status": http.statusCode, "headers": headers, "data": text]))
        }

        lock.lock()
        let alreadyCancelled = cancelledEarly.remove(id) != nil
        if !alreadyCancelled { tasks[id] = task }
        lock.unlock()

        if alreadyCancelled {
            completion(.failure(Failure(code: "ABORTED", message: "Aborted")))
            return
        }
        task.resume()
    }

    func cancel(id: String) {
        guard !id.isEmpty else { return }
        lock.lock()
        let task = tasks.removeValue(forKey: id)
        if task == nil {
            cancelledEarly.insert(id)
            // Keep the early-cancel set small; ids are unique per request.
            if cancelledEarly.count > 256 { cancelledEarly.removeAll() }
        }
        lock.unlock()
        task?.cancel()
    }

    private func forget(_ id: String) {
        lock.lock()
        tasks.removeValue(forKey: id)
        lock.unlock()
    }

    // MARK: - CI self-test

    /// Launch argument `-ccNativeHttpSelfTest`: proves, inside a real iOS runtime, that the app can
    /// reach api.openai.com natively (unauthenticated `GET /v1/models` → 401) and that cancelling a
    /// request aborts it. Results go to `Documents/cc_nativehttp_selftest.txt` for the CI job.
    func runSelfTest() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let out = docs.appendingPathComponent("cc_nativehttp_selftest.txt")
        var lines: [String] = []
        let lineLock = NSLock()
        let group = DispatchGroup()
        func record(_ s: String) {
            lineLock.lock(); lines.append(s); lineLock.unlock()
            NSLog("CC_NATIVEHTTP %@", s)
        }

        let url = URL(string: "https://api.openai.com/v1/models")!
        group.enter()
        perform(URLRequest(url: url), id: "selftest-status") { result in
            switch result {
            case .success(let p): record("status=\(p["status"] ?? "?")")
            case .failure(let f): record("status-error=\(f.code) \(f.message)")
            }
            group.leave()
        }

        group.enter()
        perform(URLRequest(url: url), id: "selftest-cancel") { result in
            switch result {
            case .success: record("cancel=not-cancelled")
            case .failure(let f): record("cancel=\(f.code)")
            }
            group.leave()
        }
        cancel(id: "selftest-cancel")

        group.notify(queue: .global()) {
            lineLock.lock()
            let text = lines.sorted().joined(separator: "\n") + "\n"
            lineLock.unlock()
            try? text.write(to: out, atomically: true, encoding: .utf8)
        }
    }
}
